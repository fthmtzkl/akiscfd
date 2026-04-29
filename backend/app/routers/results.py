"""
Results router – retrieve completed simulation results and static VTK files.
"""
from __future__ import annotations

import json
import logging
from pathlib import Path

from fastapi import APIRouter, HTTPException, status
from fastapi.responses import FileResponse

from ..core.config import settings
from ..models.schemas import JobStatus, JobStatusResponse, SimulationResults

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/results", tags=["results"])

# Import in-memory job store from simulation router
from .simulation import _get_job, _JOBS  # noqa: E402


@router.get(
    "/{job_id}",
    response_model=SimulationResults,
    summary="Get full results for a completed simulation",
)
async def get_results(job_id: str):
    """
    Return the full simulation results including force coefficients,
    residuals, pressure stats, and VTK file URLs.

    The job must be in `completed` or `failed` status.
    """
    data = _get_job(job_id)

    if not data:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Job '{job_id}' not found.",
        )

    current_status = JobStatus(data.get("status", "pending"))

    if current_status not in (JobStatus.completed, JobStatus.failed):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Job is not yet finished (current status: {current_status.value}). "
                   "Poll /simulate/{job_id}/status to wait for completion.",
        )

    results_data = data.get("results")
    if not results_data:
        return SimulationResults(
            job_id=job_id,
            status=current_status,
            error_message=data.get("error_message", "No results available."),
        )

    return SimulationResults(**results_data)


@router.get(
    "/{job_id}/vtk/{filename}",
    summary="Download a VTK result file",
    response_class=FileResponse,
)
async def download_vtk_file(job_id: str, filename: str):
    """
    Serve a VTK file (*.vtp, *.vtu) generated during post-processing.
    These are referenced by the `vtk_surface_url` etc. fields in the results.
    """
    # Security: prevent path traversal
    if ".." in filename or "/" in filename:
        raise HTTPException(status_code=400, detail="Invalid filename.")

    vtk_path = settings.SIMULATIONS_DIR / "results" / job_id / filename
    if not vtk_path.exists():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"VTK file '{filename}' not found for job '{job_id}'.",
        )

    return FileResponse(
        path=str(vtk_path),
        media_type="application/octet-stream",
        filename=filename,
    )


@router.get(
    "/{job_id}/residuals",
    summary="Get residual history for a job",
)
async def get_residuals(job_id: str):
    """
    Return the residual history parsed from the simpleFoam log file.
    Useful for plotting convergence in the frontend.
    """
    from ..services.post_process import parse_residuals

    log_path = settings.SIMULATIONS_DIR / job_id / "log.simpleFoam"
    if not log_path.exists():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Log file not found for job '{job_id}'.",
        )

    residuals = parse_residuals(log_path)
    return {"job_id": job_id, "residuals": residuals}


@router.delete(
    "/{job_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Delete all data for a simulation job",
)
async def delete_job(job_id: str):
    """Remove case directory, results, and Redis entry."""
    import shutil

    # Remove from in-memory store / Redis
    _JOBS.pop(job_id, None)
    try:
        import redis
        r = redis.from_url(settings.REDIS_URL, decode_responses=True, socket_connect_timeout=1)
        r.ping()
        r.delete(f"job:{job_id}")
    except Exception:
        pass

    # Remove simulation directory
    sim_dir = settings.SIMULATIONS_DIR / job_id
    if sim_dir.exists():
        shutil.rmtree(sim_dir, ignore_errors=True)

    # Remove results directory
    res_dir = settings.SIMULATIONS_DIR / "results" / job_id
    if res_dir.exists():
        shutil.rmtree(res_dir, ignore_errors=True)

    logger.info("Deleted job %s", job_id)
