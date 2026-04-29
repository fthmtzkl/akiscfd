"""
Simulation router – submit jobs and stream status updates.
Runs in-memory when Redis is unavailable (local dev mode).
"""
from __future__ import annotations

import json
import logging
import uuid
from datetime import datetime
from pathlib import Path
from typing import AsyncGenerator, Dict, Any

from fastapi import APIRouter, BackgroundTasks, HTTPException, status
from fastapi.responses import StreamingResponse

from ..core.config import settings
from ..models.schemas import (
    JobStatus,
    JobStatusResponse,
    SimulationRequest,
    SimulationResponse,
    SimulationResults,
)

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/simulate", tags=["simulation"])

# ---------------------------------------------------------------------------
# In-memory job store (fallback when Redis is not available)
# ---------------------------------------------------------------------------

_JOBS: Dict[str, Dict[str, Any]] = {}

JOB_TTL_SECONDS = 86_400


def _get_redis():
    try:
        import redis
        r = redis.from_url(settings.REDIS_URL, decode_responses=True, socket_connect_timeout=1)
        r.ping()
        return r
    except Exception:
        return None


def _store_job(job_id: str, data: dict) -> None:
    r = _get_redis()
    if r:
        r.setex(f"job:{job_id}", JOB_TTL_SECONDS, json.dumps(data, default=str))
    else:
        _JOBS[job_id] = dict(data)


def _get_job(job_id: str) -> dict:
    r = _get_redis()
    if r:
        raw = r.get(f"job:{job_id}")
        return json.loads(raw) if raw else {}
    return dict(_JOBS.get(job_id, {}))


def _update_job(job_id: str, **kwargs) -> None:
    r = _get_redis()
    if r:
        raw = r.get(f"job:{job_id}")
        data = json.loads(raw) if raw else {}
        data.update(kwargs)
        r.setex(f"job:{job_id}", JOB_TTL_SECONDS, json.dumps(data, default=str))
    else:
        if job_id in _JOBS:
            _JOBS[job_id].update(kwargs)


# ---------------------------------------------------------------------------
# POST /simulate
# ---------------------------------------------------------------------------

@router.post(
    "",
    response_model=SimulationResponse,
    status_code=status.HTTP_202_ACCEPTED,
    summary="Submit a new CFD simulation",
)
async def submit_simulation(
    request: SimulationRequest,
    background_tasks: BackgroundTasks,
):
    geometry_files = list(settings.UPLOAD_DIR.glob(f"{request.geometry_id}.*"))
    if not geometry_files:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Geometry '{request.geometry_id}' not found. Upload it first.",
        )
    geometry_path = geometry_files[0]

    job_id = str(uuid.uuid4())

    _store_job(job_id, {
        "job_id": job_id,
        "status": JobStatus.pending.value,
        "progress_percent": 0,
        "current_step": "Queued",
        "created_at": datetime.utcnow().isoformat(),
        "request": request.model_dump(),
    })

    background_tasks.add_task(
        _run_simulation_task,
        job_id=job_id,
        geometry_path=geometry_path,
        request=request,
    )

    return SimulationResponse(
        job_id=job_id,
        status=JobStatus.pending,
        message="Simulation submitted. Use the job_id to track progress.",
    )


# ---------------------------------------------------------------------------
# GET /simulate/{job_id}/status
# ---------------------------------------------------------------------------

@router.get(
    "/{job_id}/status",
    response_model=JobStatusResponse,
    summary="Poll simulation job status",
)
async def get_job_status(job_id: str):
    data = _get_job(job_id)
    if not data:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Job '{job_id}' not found.",
        )

    results_data = data.get("results")
    results_obj = None
    if results_data:
        try:
            results_obj = SimulationResults(**results_data)
        except Exception:
            pass

    return JobStatusResponse(
        job_id=job_id,
        status=JobStatus(data.get("status", "pending")),
        progress_percent=data.get("progress_percent", 0),
        current_step=data.get("current_step", ""),
        error_message=data.get("error_message"),
        results=results_obj,
    )


# ---------------------------------------------------------------------------
# GET /simulate/{job_id}/stream – Server-Sent Events
# ---------------------------------------------------------------------------

@router.get(
    "/{job_id}/stream",
    summary="Stream job progress via Server-Sent Events",
)
async def stream_job_progress(job_id: str):
    import asyncio

    async def _event_generator() -> AsyncGenerator[str, None]:
        while True:
            data = _get_job(job_id)
            if not data:
                yield _sse_event({"error": f"Job {job_id} not found"})
                return

            terminal = {JobStatus.completed.value, JobStatus.failed.value}
            is_terminal = data.get("status") in terminal

            payload: dict = {
                "job_id": job_id,
                "status": data.get("status"),
                "progress_percent": data.get("progress_percent", 0),
                "current_step": data.get("current_step", ""),
                "error_message": data.get("error_message"),
            }
            # Include full results on final event so the frontend doesn't need
            # a separate GET request.
            if is_terminal and data.get("results"):
                payload["results"] = data["results"]

            yield _sse_event(payload)

            if is_terminal:
                return

            await asyncio.sleep(1.0)

    return StreamingResponse(
        _event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


# ---------------------------------------------------------------------------
# Background simulation task
# ---------------------------------------------------------------------------

def _run_simulation_task(
    job_id: str,
    geometry_path: Path,
    request: SimulationRequest,
) -> None:
    import shutil

    def _progress(pct: int, step: str, job_status: JobStatus = JobStatus.running):
        _update_job(job_id, status=job_status.value, progress_percent=pct, current_step=step)

    # Try real OpenFOAM runner first; fall back to mock
    openfoam_available = shutil.which("simpleFoam") is not None

    if openfoam_available:
        from ..services.cfd_runner import run_simulation
    else:
        from ..services.mock_runner import run_simulation  # type: ignore

    results = run_simulation(
        job_id=job_id,
        geometry_path=geometry_path,
        request=request,
        progress_callback=_progress,
    )

    _update_job(
        job_id,
        status=results.status.value,
        progress_percent=100 if results.status == JobStatus.completed else 0,
        current_step="Completed" if results.status == JobStatus.completed else "Failed",
        error_message=results.error_message,
        results=results.model_dump(mode="json"),
        completed_at=datetime.utcnow().isoformat(),
    )


def _sse_event(data: dict) -> str:
    return f"data: {json.dumps(data, default=str)}\n\n"
