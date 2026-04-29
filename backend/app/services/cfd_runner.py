"""
CFD Runner Service – manages the full OpenFOAM simulation pipeline:

  1. Set up OpenFOAM case directory from templates
  2. Copy user STL to constant/triSurface/
  3. Patch boundary conditions (U, p, k, omega/epsilon) based on request params
  4. Run blockMesh or use Gmsh-generated mesh (gmshToFoam)
  5. Run surfaceFeatureExtract + snappyHexMesh
  6. Run checkMesh
  7. Run decomposePar (if parallel)
  8. Run simpleFoam
  9. Run reconstructPar (if parallel)
  10. Post-process results

All subprocess calls source the OpenFOAM bashrc so the environment is set up
correctly even inside Docker.
"""
from __future__ import annotations

import json
import logging
import math
import re
import shutil
import subprocess
import time
import uuid
from pathlib import Path
from typing import Any, Callable, Dict, Optional

from ..core.config import settings
from ..models.schemas import (
    ForceCoefficients,
    JobStatus,
    MeshQuality,
    SimulationRequest,
    SimulationResults,
    TurbulenceModel,
)
from .mesh_gen import convert_msh_to_foam, generate_mesh
from .post_process import (
    compute_noise_spl,
    compute_reynolds_number,
    convert_results_to_vtkjs,
    get_field_stats,
    get_stl_surface_area,
    parse_force_coefficients,
    parse_residuals,
)

logger = logging.getLogger(__name__)

# Number of parallel MPI processes (set >1 only when OpenMPI is available)
N_PROCESSORS = 1


# ---------------------------------------------------------------------------
# Public entry point (called by Celery task)
# ---------------------------------------------------------------------------

def run_simulation(
    job_id: str,
    geometry_path: Path,
    request: SimulationRequest,
    progress_callback: Optional[Callable[[int, str, JobStatus], None]] = None,
) -> SimulationResults:
    """
    Execute the full CFD pipeline and return SimulationResults.

    Parameters
    ----------
    job_id          : Unique job identifier.
    geometry_path   : Path to the uploaded STL file.
    request         : Validated SimulationRequest.
    progress_callback : Optional callable(percent, step_name, status).
    """

    def _progress(pct: int, step: str, status: JobStatus = JobStatus.running):
        logger.info("[%s] %d%% – %s", job_id, pct, step)
        if progress_callback:
            progress_callback(pct, step, status)

    case_dir = settings.SIMULATIONS_DIR / job_id
    results_dir = settings.SIMULATIONS_DIR / "results" / job_id

    try:
        # ------------------------------------------------------------------
        # 1. Prepare case directory
        # ------------------------------------------------------------------
        _progress(5, "Preparing case directory", JobStatus.preprocessing)
        _prepare_case_dir(case_dir, geometry_path, request)

        # ------------------------------------------------------------------
        # 2. Patch initial & boundary conditions BEFORE meshing
        #    (blockMesh reads controlDict which contains __END_TIME__)
        # ------------------------------------------------------------------
        _progress(20, "Setting boundary conditions", JobStatus.preprocessing)
        _write_initial_conditions(case_dir, request)

        # ------------------------------------------------------------------
        # 3. Mesh generation
        # ------------------------------------------------------------------
        _progress(30, "Generating mesh", JobStatus.meshing)
        _run_meshing(case_dir, geometry_path, request)

        # ------------------------------------------------------------------
        # 4. Run simpleFoam solver
        # ------------------------------------------------------------------
        _progress(40, "Running CFD solver (simpleFoam)", JobStatus.running)
        log_path = _run_solver(case_dir, request)

        # ------------------------------------------------------------------
        # 5. Post-processing
        # ------------------------------------------------------------------
        _progress(85, "Post-processing results", JobStatus.postprocessing)
        results = _post_process(
            job_id=job_id,
            case_dir=case_dir,
            results_dir=results_dir,
            log_path=log_path,
            request=request,
            geometry_path=geometry_path,
        )

        _progress(100, "Completed", JobStatus.completed)
        return results

    except Exception as exc:
        logger.exception("Simulation %s failed: %s", job_id, exc)
        return SimulationResults(
            job_id=job_id,
            status=JobStatus.failed,
            error_message=str(exc),
        )


# ---------------------------------------------------------------------------
# Step 1: Prepare case directory
# ---------------------------------------------------------------------------

def _prepare_case_dir(
    case_dir: Path,
    geometry_path: Path,
    request: SimulationRequest,
) -> None:
    """Copy OpenFOAM template and STL geometry into the case directory."""
    if case_dir.exists():
        shutil.rmtree(case_dir)

    templates = settings.OPENFOAM_TEMPLATES_DIR
    shutil.copytree(str(templates), str(case_dir))

    tri_dir = case_dir / "constant" / "triSurface"
    tri_dir.mkdir(parents=True, exist_ok=True)
    dest_stl = tri_dir / "geometry.stl"

    # Attempt to repair/close the mesh before handing it to OpenFOAM.
    # snappyHexMesh requires a watertight (closed) surface.
    _repair_stl(geometry_path, dest_stl)

    logger.info("Case directory prepared at %s", case_dir)


def _repair_stl(src: Path, dst: Path) -> None:
    """
    Copy STL to dst, repairing non-watertight meshes when possible.
    Uses trimesh for repair; falls back to a raw copy if unavailable.
    """
    try:
        import trimesh
        mesh = trimesh.load_mesh(str(src), force="mesh")
        if not mesh.is_watertight:
            logger.warning("STL is not watertight – attempting repair")
            trimesh.repair.fill_holes(mesh)
            trimesh.repair.fix_normals(mesh)
            trimesh.repair.fix_winding(mesh)
        mesh.export(str(dst), file_type="stl")
        logger.info("STL repaired/exported: watertight=%s, faces=%d", mesh.is_watertight, len(mesh.faces))
    except Exception as exc:
        logger.warning("trimesh repair failed (%s) – using raw copy", exc)
        shutil.copy2(str(src), str(dst))


# ---------------------------------------------------------------------------
# Step 2: Meshing
# ---------------------------------------------------------------------------

def _run_meshing(
    case_dir: Path,
    geometry_path: Path,
    request: SimulationRequest,
) -> None:
    """
    Generate mesh using either Gmsh + gmshToFoam, or the snappyHexMesh pipeline.
    We attempt Gmsh first; if it fails we fall back to snappyHexMesh.
    """
    try:
        import gmsh as _gmsh_mod  # noqa: F401
        _use_gmsh = True
    except ImportError:
        _use_gmsh = False

    if _use_gmsh:
        logger.info("Using Gmsh for mesh generation")
        msh_path = generate_mesh(geometry_path, case_dir, request.mesh_quality.value)
        convert_msh_to_foam(msh_path, case_dir, settings.OPENFOAM_BASHRC)
        # Fix boundary types produced by gmshToFoam
        _run_foam_cmd("changeDictionary", case_dir)
    else:
        logger.info("Using snappyHexMesh pipeline")
        _run_snappy_pipeline(case_dir, request)


def _run_snappy_pipeline(case_dir: Path, request: SimulationRequest) -> None:
    """blockMesh → surfaceFeatureExtract → snappyHexMesh."""
    # Patch snappyHexMeshDict with mesh quality settings
    _patch_snappy_dict(case_dir, request.mesh_quality)

    _run_foam_cmd("blockMesh", case_dir)
    _run_foam_cmd("surfaceFeatureExtract", case_dir)
    _run_foam_cmd("snappyHexMesh -overwrite", case_dir)
    _run_foam_cmd("checkMesh", case_dir)


def _patch_snappy_dict(case_dir: Path, mesh_quality: MeshQuality) -> None:
    """Adjust refinement levels and cell limits in snappyHexMeshDict."""
    # surf_min/max: surface refinement (refinementSurfaces)
    # box_level: wake/near-field box refinement (refinementRegions → refinementBox)
    # max_cells: global cell cap to prevent OOM
    cfg = {
        MeshQuality.coarse: dict(surf_min=2, surf_max=3, box_level=1, max_cells=2_000_000),
        MeshQuality.medium: dict(surf_min=3, surf_max=5, box_level=2, max_cells=6_000_000),
        MeshQuality.fine:   dict(surf_min=5, surf_max=6, box_level=3, max_cells=15_000_000),
    }
    c = cfg.get(mesh_quality, cfg[MeshQuality.medium])

    snappy_path = case_dir / "system" / "snappyHexMeshDict"
    if not snappy_path.exists():
        return
    text = snappy_path.read_text()

    # refinementSurfaces: level (min max)
    text = re.sub(r"(level\s+)\(\d+ \d+\)", f"\\1({c['surf_min']} {c['surf_max']})", text)

    # refinementRegions box: levels ((1E15 X))
    text = re.sub(
        r"(levels\s+\(\(1E15\s+)\d+(\)\))",
        lambda m: m.group(1) + str(c['box_level']) + m.group(2),
        text,
    )

    # Global cell cap
    text = re.sub(r"maxGlobalCells\s+\d+", f"maxGlobalCells      {c['max_cells']}", text)

    snappy_path.write_text(text)


# ---------------------------------------------------------------------------
# Step 3: Initial & boundary conditions
# ---------------------------------------------------------------------------

def _write_initial_conditions(case_dir: Path, request: SimulationRequest) -> None:
    """
    Patch the 0/ directory files with the correct inlet velocity, turbulence
    intensity, etc., derived from the simulation request.
    """
    angle_rad = math.radians(request.wind_angle_deg)
    Ux = request.wind_speed * math.cos(angle_rad)
    Uy = request.wind_speed * math.sin(angle_rad)
    Uz = 0.0

    # Turbulence intensity 5 %, length scale 10 % of inlet
    I = 0.05
    k_val   = 1.5 * (request.wind_speed * I) ** 2
    L       = 0.1  # integral length scale [m]
    Cmu     = 0.09
    epsilon = Cmu ** 0.75 * k_val ** 1.5 / L
    omega   = k_val ** 0.5 / (Cmu ** 0.25 * L)

    # All shared values live in the included initialConditions file
    _patch_field_file(
        case_dir / "0" / "initialConditions",
        replacements={
            "__WIND_VELOCITY__": f"({Ux:.4f} {Uy:.4f} {Uz:.4f})",
            "__K_VALUE__":       f"{k_val:.6f}",
            "__OMEGA_VALUE__":   f"{omega:.6f}",
            "__EPSILON_VALUE__": f"{epsilon:.6f}",
        },
    )

    # Patch turbulenceProperties to select model
    turb_model_name = request.turbulence_model.value  # "kEpsilon" or "kOmegaSST"
    _patch_field_file(
        case_dir / "constant" / "turbulenceProperties",
        replacements={"__TURBULENCE_MODEL__": turb_model_name},
    )

    # Patch controlDict with number of iterations
    _patch_field_file(
        case_dir / "system" / "controlDict",
        replacements={"__END_TIME__": str(request.num_iterations)},
    )


def _patch_field_file(path: Path, replacements: Dict[str, str]) -> None:
    if not path.exists():
        logger.warning("Template file not found: %s", path)
        return
    text = path.read_text()
    for placeholder, value in replacements.items():
        text = text.replace(placeholder, value)
    path.write_text(text)


# ---------------------------------------------------------------------------
# Step 4: Run solver
# ---------------------------------------------------------------------------

def _run_solver(case_dir: Path, request: SimulationRequest) -> Path:
    """Run simpleFoam and return the path to the log file."""
    log_path = case_dir / "log.simpleFoam"
    cmd = (
        f"source {settings.OPENFOAM_BASHRC} && "
        f"cd {case_dir} && "
        f"simpleFoam 2>&1 | tee {log_path}"
    )
    logger.info("Starting simpleFoam in %s", case_dir)
    result = subprocess.run(
        ["bash", "-c", cmd],
        timeout=settings.JOB_TIMEOUT_SECONDS,
        capture_output=False,  # tee handles output
    )
    if result.returncode != 0:
        raise RuntimeError(
            f"simpleFoam exited with code {result.returncode}. "
            f"Check log at {log_path}"
        )
    return log_path


# ---------------------------------------------------------------------------
# Step 5: Post-process
# ---------------------------------------------------------------------------

def _post_process(
    job_id: str,
    case_dir: Path,
    results_dir: Path,
    log_path: Path,
    request: SimulationRequest,
    geometry_path: Optional[Path] = None,
) -> SimulationResults:
    """Gather all results and return a SimulationResults object."""
    post_dir = case_dir / "postProcessing"

    # Force coefficients (Cd, Cl, Cs, Cf, forces in N)
    coeff_data = parse_force_coefficients(post_dir, request.wind_speed)
    force_coeffs = ForceCoefficients(**coeff_data) if coeff_data else None

    # Residuals
    residuals_raw = parse_residuals(log_path)

    # Field stats (pressure min/max, velocity max)
    stats = get_field_stats(case_dir)

    # VTK conversion for frontend 3D viewer
    vtk_urls = convert_results_to_vtkjs(case_dir, results_dir)

    # Geometry-derived quantities
    stl_path = geometry_path or (case_dir / "constant" / "triSurface" / "geometry.stl")
    surface_area  = get_stl_surface_area(stl_path)
    reynolds      = compute_reynolds_number(request.wind_speed, stl_path)

    # Acoustic estimate (BPM trailing-edge model)
    cf_val = force_coeffs.Cf if force_coeffs else 0.0
    noise  = compute_noise_spl(request.wind_speed, cf_val)

    return SimulationResults(
        job_id=job_id,
        status=JobStatus.completed,
        request=request,
        force_coefficients=force_coeffs,
        residuals=residuals_raw,  # type: ignore[arg-type]
        vtk_surface_url=vtk_urls.get("vtk_surface_url"),
        vtk_volume_url=vtk_urls.get("vtk_volume_url"),
        streamlines_url=vtk_urls.get("streamlines_url"),
        pressure_min_pa=stats.get("pressure_min_pa"),
        pressure_max_pa=stats.get("pressure_max_pa"),
        velocity_max_ms=stats.get("velocity_max_ms"),
        noise_spl_db=noise,
        surface_area_m2=surface_area,
        reynolds_number=round(reynolds, 0),
    )


# ---------------------------------------------------------------------------
# Shared helper: run an OpenFOAM command
# ---------------------------------------------------------------------------

def _run_foam_cmd(command: str, case_dir: Path, timeout: int = 600) -> None:
    """Source OpenFOAM bashrc and run `command` inside `case_dir`."""
    cmd = f"source {settings.OPENFOAM_BASHRC} && cd {case_dir} && {command}"
    logger.info("Running: %s", command)
    result = subprocess.run(
        ["bash", "-c", cmd],
        capture_output=True,
        text=True,
        timeout=timeout,
    )
    if result.returncode != 0:
        raise RuntimeError(
            f"Command '{command}' failed (exit {result.returncode}):\n"
            f"STDOUT: {result.stdout[-2000:]}\n"
            f"STDERR: {result.stderr[-2000:]}"
        )
    logger.debug("Command '%s' succeeded:\n%s", command, result.stdout[-500:])
