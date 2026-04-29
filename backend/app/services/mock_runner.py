"""
Mock CFD runner – produces realistic-looking simulation results
without requiring OpenFOAM. Used when OpenFOAM is not installed.
"""
from __future__ import annotations

import math
import random
import time
from pathlib import Path
from typing import Callable, Optional

from ..models.schemas import (
    ForceCoefficients,
    JobStatus,
    MeshQuality,
    ResidualPoint,
    SimulationRequest,
    SimulationResults,
)

import logging
logger = logging.getLogger(__name__)

RHO  = 1.225   # air density kg/m³
NU   = 1.5e-5  # kinematic viscosity m²/s
PREF = 2e-5    # acoustic reference pressure Pa


def run_simulation(
    job_id: str,
    geometry_path: Path,
    request: SimulationRequest,
    progress_callback: Optional[Callable[[int, str, JobStatus], None]] = None,
) -> SimulationResults:

    def _progress(pct: int, step: str, s: JobStatus = JobStatus.running):
        logger.info("[MOCK] [%s] %d%% – %s", job_id, pct, step)
        if progress_callback:
            progress_callback(pct, step, s)

    V = request.wind_speed  # m/s

    try:
        _progress(5,  "Preparing case directory", JobStatus.preprocessing)
        time.sleep(1.5)

        _progress(15, "Generating mesh",          JobStatus.meshing)
        mesh_delay = {"coarse": 3, "medium": 5, "fine": 8}.get(request.mesh_quality.value, 5)
        time.sleep(mesh_delay)

        _progress(30, "Setting boundary conditions", JobStatus.preprocessing)
        time.sleep(1.0)

        _progress(40, "Running CFD solver (simpleFoam)", JobStatus.running)
        residuals = _generate_residuals(request.num_iterations)

        n_iter = request.num_iterations
        chunk  = max(1, n_iter // 10)
        for i in range(0, n_iter, chunk):
            frac = min(i / n_iter, 1.0)
            pct  = int(40 + frac * 45)
            _progress(pct, f"Solver iteration {i}/{n_iter}", JobStatus.running)
            time.sleep(0.4)

        _progress(85, "Post-processing results", JobStatus.postprocessing)
        time.sleep(1.5)

        force_coeffs = _compute_force_coefficients(request)
        noise_spl    = _compute_noise(V, force_coeffs.Cf)

        _progress(100, "Completed", JobStatus.completed)

        # Estimate Reynolds number (characteristic length ≈ 4 m for car)
        L   = 4.0
        Re  = V * L / NU
        A   = force_coeffs.frontal_area_m2 or 2.2
        q   = 0.5 * RHO * V ** 2

        return SimulationResults(
            job_id=job_id,
            status=JobStatus.completed,
            request=request,
            force_coefficients=force_coeffs,
            residuals=residuals,
            pressure_min_pa=round(-q * 1.4, 2),
            pressure_max_pa=round( q * 1.0, 2),
            velocity_max_ms=round(V * 1.85, 2),
            noise_spl_db=round(noise_spl, 1),
            surface_area_m2=round(A * 4.5, 2),
            reynolds_number=round(Re, 0),
        )

    except Exception as exc:
        logger.exception("Mock simulation %s failed: %s", job_id, exc)
        return SimulationResults(
            job_id=job_id,
            status=JobStatus.failed,
            error_message=str(exc),
        )


# ---------------------------------------------------------------------------
# Aerodynamic coefficients
# ---------------------------------------------------------------------------

def _compute_force_coefficients(request: SimulationRequest) -> ForceCoefficients:
    V = request.wind_speed
    a = math.radians(request.wind_angle_deg)

    cd_base = 0.30 + 0.12 * abs(math.sin(a))
    Cd = round(abs(cd_base + random.gauss(0, 0.008)), 4)

    cl_base = 0.05 * math.sin(2 * a)
    Cl = round(cl_base + random.gauss(0, 0.006), 4)

    Cs = round(0.04 * math.sin(a) + random.gauss(0, 0.004), 4)

    # Skin friction: turbulent flat plate (Prandtl, Re based on 4 m length)
    Re = V * 4.0 / NU
    Cf = round(0.074 / Re ** 0.2, 5)

    A  = 2.2  # frontal area m²
    q  = 0.5 * RHO * V ** 2

    return ForceCoefficients(
        Cd=Cd,
        Cl=Cl,
        Cs=Cs,
        Cf=Cf,
        frontal_area_m2=A,
        reference_velocity_ms=round(V, 2),
        drag_force_n=round(Cd * q * A, 1),
        lift_force_n=round(Cl * q * A, 1),
    )


def _compute_noise(V: float, Cf: float) -> float:
    """Simplified trailing-edge noise (BPM model, A-weighted estimate)."""
    # v_surface ≈ sqrt(Cf) * V (friction velocity proxy)
    v_s = math.sqrt(abs(Cf)) * V
    # p_rms ~ rho * v_s^2 (rough dipole model)
    p_rms = RHO * v_s ** 2 * 0.01
    if p_rms < 1e-10:
        return 0.0
    spl = 20 * math.log10(p_rms / PREF)
    return max(0.0, spl)


# ---------------------------------------------------------------------------
# Residuals
# ---------------------------------------------------------------------------

def _generate_residuals(n_iter: int) -> list[ResidualPoint]:
    points = []
    sample_every = max(1, n_iter // 100)

    for i in range(0, n_iter, sample_every):
        t = i / n_iter
        decay = math.exp(-8 * t)
        noise = lambda: random.gauss(0, 0.05 * decay)

        points.append(ResidualPoint(
            iteration=i,
            Ux=max(1e-9, 0.8 * decay + noise()),
            Uy=max(1e-9, 0.6 * decay + noise()),
            Uz=max(1e-9, 0.1 * decay + noise()),
            p =max(1e-9, 0.9 * decay + noise()),
            k =max(1e-9, 0.7 * decay + noise()),
            omega=max(1e-9, 0.5 * decay + noise()),
        ))

    return points
