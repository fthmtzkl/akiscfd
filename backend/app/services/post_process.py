"""
Post-processing service: parse OpenFOAM output and produce
JSON-serialisable data structures for the frontend.

Capabilities
------------
* Parse residuals from log.simpleFoam
* Parse forceCoeffs.dat to extract Cd / Cl / Cs / Cf
* Compute Reynolds number, BPM noise SPL, and STL surface area
* Convert the final time-step VTK/OpenFOAM results to vtkjs format
  using pyvista (if available) for in-browser rendering.
"""
from __future__ import annotations

import json
import logging
import math
import re
from pathlib import Path
from typing import Dict, List, Optional, Tuple

logger = logging.getLogger(__name__)

# Physical constants
RHO  = 1.225   # air density kg/m³  (20 °C, sea level)
NU   = 1.5e-5  # kinematic viscosity m²/s
PREF = 2e-5    # acoustic reference pressure Pa


# ---------------------------------------------------------------------------
# Residuals
# ---------------------------------------------------------------------------

RESIDUAL_PATTERN = re.compile(
    r"^Time = (\d+)\s*$"
    r"|Solving for (\w+), Initial residual = ([\d.eE+\-]+)"
)


def parse_residuals(log_path: Path) -> List[Dict]:
    """
    Parse OpenFOAM simpleFoam log for residuals at each iteration.

    Returns a list of dicts:
        [{"iteration": 1, "Ux": 0.9, "Uy": 0.8, "Uz": 0.8,
          "p": 0.95, "k": 0.7, "omega": 0.6}, ...]
    """
    if not log_path.exists():
        return []

    residuals: List[Dict] = []
    current: Dict = {}
    iteration = 0

    with log_path.open() as fh:
        for line in fh:
            line = line.strip()
            # Detect time step line  "Time = N"
            time_match = re.match(r"^Time = (\d+)\s*$", line)
            if time_match:
                if current:
                    residuals.append(current)
                iteration = int(time_match.group(1))
                current = {"iteration": iteration}
                continue

            # Detect residual line
            res_match = re.search(
                r"Solving for (\w+), Initial residual = ([\d.eE+\-]+)", line
            )
            if res_match and current is not None:
                var_raw = res_match.group(1)  # e.g. Ux, p, k, omega, epsilon
                value = float(res_match.group(2))
                current[var_raw] = value

    if current:
        residuals.append(current)

    return residuals


# ---------------------------------------------------------------------------
# Force coefficients
# ---------------------------------------------------------------------------

def parse_force_coefficients(
    post_dir: Path,
    wind_speed: float,
    ref_area: Optional[float] = None,
) -> Optional[Dict]:
    """
    Parse postProcessing/forceCoeffs/0/coefficient.dat (or similar).

    OpenFOAM writes columns:
        Time  Cd  Cs  Cl  CdPressure  CdViscous  ...

    Returns a dict with Cd, Cl, Cs and metadata.
    """
    # Search for the force coefficients file
    candidates = list(post_dir.glob("**/coefficient.dat"))
    candidates += list(post_dir.glob("**/forceCoeffs.dat"))
    candidates += list(post_dir.glob("**/forces.dat"))

    if not candidates:
        logger.warning("No force coefficient file found in %s", post_dir)
        return None

    coeff_file = candidates[0]
    logger.info("Parsing force coefficients from %s", coeff_file)

    # Read the last non-comment, non-header line
    lines = [
        l.strip()
        for l in coeff_file.read_text().splitlines()
        if l.strip() and not l.strip().startswith("#")
    ]

    if not lines:
        return None

    last = lines[-1].split()
    try:
        # OpenFOAM v2312 forceCoeffs output column order:
        # [0]Time [1]Cd [2]Cd(f) [3]Cd(r) [4]Cl [5]Cl(f) [6]Cl(r)
        # [7]CmPitch [8]CmRoll [9]CmYaw [10]Cs [11]Cs(f) [12]Cs(r)
        cd = float(last[1])
        cl = float(last[4])
        cs = float(last[10]) if len(last) > 10 else 0.0
    except (IndexError, ValueError):
        logger.error("Cannot parse coefficient line: %s", lines[-1])
        return None

    # Cf: estimate via Prandtl turbulent flat-plate formula (Cf = 0.074 / Re^0.2)
    # when the viscous component is not separately written by forceCoeffs.
    Re = wind_speed / NU  # approximate (per-unit-length)
    cf = round(0.074 / (Re ** 0.2), 6) if Re > 0 else 0.0

    A = ref_area or 2.2   # fallback frontal area
    q = 0.5 * RHO * wind_speed ** 2

    return {
        "Cd": round(cd, 4),
        "Cl": round(cl, 4),
        "Cs": round(cs, 4),
        "Cf": cf,
        "frontal_area_m2": A,
        "reference_velocity_ms": wind_speed,
        "drag_force_n": round(cd * q * A, 1),
        "lift_force_n": round(cl * q * A, 1),
    }


# ---------------------------------------------------------------------------
# VTK conversion
# ---------------------------------------------------------------------------

def convert_results_to_vtkjs(
    case_dir: Path,
    output_dir: Path,
) -> Dict[str, Optional[str]]:
    """
    Convert the last time-step OpenFOAM results to vtkjs files using pyvista.

    Returns dict with keys: vtk_surface_url, vtk_volume_url, streamlines_url
    All values are relative paths (served as static files by FastAPI).
    """
    try:
        import pyvista as pv  # type: ignore
    except ImportError:
        logger.warning("pyvista not installed – skipping VTK conversion")
        return {"vtk_surface_url": None, "vtk_volume_url": None, "streamlines_url": None}

    output_dir.mkdir(parents=True, exist_ok=True)

    # Find the last time step directory
    time_dirs = sorted(
        [d for d in case_dir.iterdir() if d.is_dir() and _is_numeric(d.name)],
        key=lambda d: float(d.name),
    )
    if not time_dirs:
        logger.warning("No time step directories found in %s", case_dir)
        return {"vtk_surface_url": None, "vtk_volume_url": None, "streamlines_url": None}

    last_time = time_dirs[-1]
    logger.info("Processing time step: %s", last_time.name)

    urls: Dict[str, Optional[str]] = {
        "vtk_surface_url": None,
        "vtk_volume_url": None,
        "streamlines_url": None,
    }

    try:
        # Try reading OpenFOAM case directly
        foam_file = list(case_dir.glob("*.foam"))
        if not foam_file:
            foam_file_path = case_dir / "case.foam"
            foam_file_path.touch()
        else:
            foam_file_path = foam_file[0]

        reader = pv.OpenFOAMReader(str(foam_file_path))
        reader.set_active_time_value(float(last_time.name))
        mesh = reader.read()

        # --- Surface pressure ---
        surface = mesh.extract_surface()
        if "p" in surface.point_data:
            surface_path = output_dir / "surface_pressure.vtp"
            surface.save(str(surface_path))
            urls["vtk_surface_url"] = f"results/{output_dir.name}/surface_pressure.vtp"

        # --- Volume (pressure + velocity magnitude) ---
        if "p" in mesh.point_data or "U" in mesh.point_data:
            if "U" in mesh.point_data:
                u = mesh.point_data["U"]
                import numpy as np
                mesh.point_data["U_mag"] = np.linalg.norm(u, axis=1)
            volume_path = output_dir / "volume_fields.vtu"
            mesh.save(str(volume_path))
            urls["vtk_volume_url"] = f"results/{output_dir.name}/volume_fields.vtu"

        # --- Streamlines ---
        if "U" in mesh.point_data:
            seed_points = pv.Disc(
                center=(-5, 0, 1),
                normal=(1, 0, 0),
                inner=0,
                outer=2,
                r_res=3,
                c_res=12,
            )
            streamlines = mesh.streamlines_from_source(
                seed_points,
                vectors="U",
                integration_direction="forward",
                max_time=50.0,
            )
            sl_path = output_dir / "streamlines.vtp"
            streamlines.save(str(sl_path))
            urls["streamlines_url"] = f"results/{output_dir.name}/streamlines.vtp"

    except Exception as exc:
        logger.error("VTK conversion error: %s", exc, exc_info=True)

    return urls


# ---------------------------------------------------------------------------
# Pressure / velocity stats from last time step
# ---------------------------------------------------------------------------

def get_field_stats(case_dir: Path) -> Dict[str, Optional[float]]:
    """
    Return min/max pressure and max velocity magnitude from the last time step.
    Uses pyvista if available, otherwise falls back to parsing the 'p' and 'U' files.
    """
    stats: Dict[str, Optional[float]] = {
        "pressure_min_pa": None,
        "pressure_max_pa": None,
        "velocity_max_ms": None,
    }

    time_dirs = sorted(
        [d for d in case_dir.iterdir() if d.is_dir() and _is_numeric(d.name)],
        key=lambda d: float(d.name),
    )
    if not time_dirs:
        return stats

    last_time = time_dirs[-1]

    # Try pyvista first
    try:
        import pyvista as pv
        import numpy as np

        foam_file = list(case_dir.glob("*.foam"))
        if not foam_file:
            foam_fp = case_dir / "case.foam"
            foam_fp.touch()
        else:
            foam_fp = foam_file[0]

        reader = pv.OpenFOAMReader(str(foam_fp))
        reader.set_active_time_value(float(last_time.name))
        mesh = reader.read()

        if "p" in mesh.point_data:
            # simpleFoam stores kinematic pressure (p/rho in m²/s²); convert to Pa
            p = mesh.point_data["p"] * RHO
            stats["pressure_min_pa"] = float(np.min(p))
            stats["pressure_max_pa"] = float(np.max(p))
        if "U" in mesh.point_data:
            u_mag = np.linalg.norm(mesh.point_data["U"], axis=1)
            stats["velocity_max_ms"] = float(np.max(u_mag))

        return stats
    except Exception:
        pass

    # Fallback: parse OpenFOAM internal text format
    p_file = last_time / "p"
    u_file = last_time / "U"

    if p_file.exists():
        pmin, pmax = _parse_field_minmax(p_file)
        # kinematic pressure (m²/s²) → Pa
        stats["pressure_min_pa"] = pmin * RHO if pmin is not None else None
        stats["pressure_max_pa"] = pmax * RHO if pmax is not None else None

    if u_file.exists():
        umin, umax = _parse_field_minmax(u_file)
        stats["velocity_max_ms"] = umax

    return stats


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _is_numeric(s: str) -> bool:
    try:
        float(s)
        return True
    except ValueError:
        return False


def _parse_field_minmax(field_file: Path) -> Tuple[Optional[float], Optional[float]]:
    """Very simple parser for OpenFOAM internalField data to get min/max."""
    try:
        text = field_file.read_text()
        # Look for numeric values after 'internalField nonuniform List<scalar>'
        match = re.search(r"internalField\s+nonuniform\s+List<scalar>\s+\d+\s*\(([^)]+)\)", text, re.S)
        if match:
            values = [float(v) for v in match.group(1).split()]
            return min(values), max(values)
        # uniform value
        match_uni = re.search(r"internalField\s+uniform\s+([\d.eE+\-]+)", text)
        if match_uni:
            v = float(match_uni.group(1))
            return v, v
    except Exception as exc:
        logger.debug("Field parse error for %s: %s", field_file, exc)
    return None, None


# ---------------------------------------------------------------------------
# Geometry-derived metrics
# ---------------------------------------------------------------------------

def get_stl_surface_area(stl_path: Path) -> Optional[float]:
    """
    Return total surface area (m²) of the STL geometry.
    Uses numpy-stl when available, falls back to pyvista.
    """
    # numpy-stl (fast, no GUI deps)
    try:
        from stl import mesh as stl_mesh  # type: ignore
        import numpy as np

        m = stl_mesh.Mesh.from_file(str(stl_path))
        # Cross-product of two edge vectors gives the face normal scaled by 2*area
        e1 = m.v1 - m.v0
        e2 = m.v2 - m.v0
        crosses = np.cross(e1, e2)
        area = 0.5 * float(np.sum(np.linalg.norm(crosses, axis=1)))
        return round(area, 3)
    except Exception:
        pass

    # pyvista fallback
    try:
        import pyvista as pv
        mesh = pv.read(str(stl_path))
        return round(float(mesh.area), 3)
    except Exception as exc:
        logger.debug("Surface area computation failed: %s", exc)
        return None


def get_stl_bounding_box(stl_path: Path) -> Optional[Dict[str, float]]:
    """Return xmin/xmax/ymin/ymax/zmin/zmax of the STL in metres."""
    try:
        from stl import mesh as stl_mesh  # type: ignore
        import numpy as np

        m = stl_mesh.Mesh.from_file(str(stl_path))
        pts = m.vectors.reshape(-1, 3)
        return {
            "xmin": float(np.min(pts[:, 0])), "xmax": float(np.max(pts[:, 0])),
            "ymin": float(np.min(pts[:, 1])), "ymax": float(np.max(pts[:, 1])),
            "zmin": float(np.min(pts[:, 2])), "zmax": float(np.max(pts[:, 2])),
        }
    except Exception:
        pass

    try:
        import pyvista as pv
        mesh = pv.read(str(stl_path))
        b = mesh.bounds  # (xmin, xmax, ymin, ymax, zmin, zmax)
        return {
            "xmin": b[0], "xmax": b[1],
            "ymin": b[2], "ymax": b[3],
            "zmin": b[4], "zmax": b[5],
        }
    except Exception as exc:
        logger.debug("Bounding box computation failed: %s", exc)
        return None


def compute_reynolds_number(wind_speed: float, stl_path: Optional[Path] = None) -> float:
    """
    Re = V * L / nu
    L is the longest bounding-box dimension (characteristic length).
    Falls back to 4.0 m if STL cannot be read.
    """
    L = 4.0  # default: ~car length
    if stl_path and stl_path.exists():
        bbox = get_stl_bounding_box(stl_path)
        if bbox:
            L = max(
                bbox["xmax"] - bbox["xmin"],
                bbox["ymax"] - bbox["ymin"],
                bbox["zmax"] - bbox["zmin"],
            )
    return wind_speed * L / NU


def compute_noise_spl(wind_speed: float, cf: float) -> float:
    """
    Simplified A-weighted trailing-edge noise estimate (BPM model).

    Uses the Brooks-Pope-Marcolini boundary-layer self-noise model:
      p_rms ~ rho * u_tau^2  where u_tau = sqrt(tau_w/rho) ≈ sqrt(Cf/2) * V
    The A-weighting correction (~−3 dB at 1 kHz for road vehicles) is baked in.
    Returns SPL in dB(A).
    """
    u_tau = math.sqrt(abs(cf) / 2.0) * wind_speed  # friction velocity
    p_rms = RHO * u_tau ** 2 * 0.02               # dipole radiation factor
    if p_rms < 1e-10:
        return 0.0
    spl = 20.0 * math.log10(p_rms / PREF) - 3.0   # −3 dB A-weight correction
    return round(max(0.0, spl), 1)
