"""
Celery application for async CFD simulation tasks.

Usage (inside container):
    celery -A app.celery_app worker --loglevel=info --queues=cfd_simulations

Sending a task (from FastAPI router):
    from app.celery_app import run_simulation_task
    run_simulation_task.apply_async(
        args=[job_id, str(geometry_path), request.dict()],
        queue="cfd_simulations",
    )
"""
from __future__ import annotations

import json
import logging
from datetime import datetime
from pathlib import Path

from celery import Celery

from .core.config import settings
from .models.schemas import JobStatus, SimulationRequest

logger = logging.getLogger(__name__)

# ─────────────────────────────────────────────────────────────────────────────
# Celery instance
# ─────────────────────────────────────────────────────────────────────────────

celery_app = Celery(
    "cfd_web_app",
    broker=settings.CELERY_BROKER_URL,
    backend=settings.CELERY_RESULT_BACKEND,
)

celery_app.conf.update(
    task_serializer="json",
    result_serializer="json",
    accept_content=["json"],
    timezone="UTC",
    enable_utc=True,
    task_routes={
        "app.celery_app.run_simulation_task": {"queue": "cfd_simulations"},
    },
    worker_max_tasks_per_child=10,  # Restart worker after N tasks (memory safety)
    task_time_limit=settings.JOB_TIMEOUT_SECONDS,
    task_soft_time_limit=settings.JOB_TIMEOUT_SECONDS - 60,
)


# ─────────────────────────────────────────────────────────────────────────────
# Task definition
# ─────────────────────────────────────────────────────────────────────────────

@celery_app.task(
    bind=True,
    name="app.celery_app.run_simulation_task",
    acks_late=True,
    reject_on_worker_lost=True,
)
def run_simulation_task(self, job_id: str, geometry_path_str: str, request_dict: dict):
    """
    Celery task that runs the full CFD pipeline.

    Parameters
    ----------
    job_id           : Unique job identifier (UUID).
    geometry_path_str: Absolute path to the uploaded geometry file.
    request_dict     : Serialised SimulationRequest dict.
    """
    import redis as redis_lib

    r = redis_lib.from_url(settings.REDIS_URL, decode_responses=True)
    geometry_path = Path(geometry_path_str)
    request = SimulationRequest(**request_dict)

    JOB_TTL = 86_400  # 24 h

    def _update(status: str, pct: int, step: str, **kwargs):
        data = json.loads(r.get(f"job:{job_id}") or "{}")
        data.update(status=status, progress_percent=pct, current_step=step, **kwargs)
        r.setex(f"job:{job_id}", JOB_TTL, json.dumps(data, default=str))
        # Also update Celery task state
        self.update_state(
            state="PROGRESS",
            meta={"percent": pct, "step": step, "status": status},
        )

    def _progress_callback(pct: int, step: str, job_status: JobStatus):
        _update(job_status.value, pct, step)

    logger.info("Celery task started: job_id=%s", job_id)
    _update(JobStatus.preprocessing.value, 5, "Starting simulation")

    import shutil
    if shutil.which("simpleFoam"):
        from .services.cfd_runner import run_simulation
    else:
        logger.warning("OpenFOAM not found – using mock runner")
        from .services.mock_runner import run_simulation  # type: ignore

    results = run_simulation(
        job_id=job_id,
        geometry_path=geometry_path,
        request=request,
        progress_callback=_progress_callback,
    )

    final_status = results.status.value
    _update(
        final_status,
        100 if results.status == JobStatus.completed else 0,
        "Completed" if results.status == JobStatus.completed else "Failed",
        error_message=results.error_message,
        results=results.model_dump(mode="json"),
        completed_at=datetime.utcnow().isoformat(),
    )

    logger.info("Celery task finished: job_id=%s status=%s", job_id, final_status)
    return {"job_id": job_id, "status": final_status}
