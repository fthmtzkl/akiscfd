"""
CFD Web Application – FastAPI entry point.

Endpoints:
  POST /upload/geometry          – Upload a 3D geometry file (STL/OBJ/STEP)
  POST /simulate                 – Submit a CFD simulation job
  GET  /simulate/{job_id}/status – Poll job status
  GET  /simulate/{job_id}/stream – Server-Sent Events for live progress
  GET  /results/{job_id}         – Get full simulation results
  GET  /results/{job_id}/vtk/{f} – Download VTK output file
  GET  /results/{job_id}/residuals – Residual convergence history
  DELETE /results/{job_id}       – Delete job and all associated data
  DELETE /upload/geometry/{id}   – Delete uploaded geometry

Static files served from /static (frontend build output).
"""
import logging
import sys
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from .core.config import settings
from .db.database import create_tables
from .routers import results, simulation, upload
from .routers import auth as auth_router

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------

logging.basicConfig(
    level=logging.DEBUG if settings.DEBUG else logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(name)s  %(message)s",
    stream=sys.stdout,
)
logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Application lifecycle
# ---------------------------------------------------------------------------

@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("AkisCFD starting up (version %s)", settings.APP_VERSION)
    settings.ensure_dirs()
    create_tables()
    logger.info("Database tables ready")

    # Verify Redis is reachable (warn, don't fail)
    try:
        import redis
        r = redis.from_url(settings.REDIS_URL)
        r.ping()
        logger.info("Redis connection OK (%s)", settings.REDIS_URL)
    except Exception as exc:
        logger.warning(
            "Redis not reachable at %s – job status persistence disabled: %s",
            settings.REDIS_URL,
            exc,
        )

    yield
    logger.info("CFD Web App shutting down")


# ---------------------------------------------------------------------------
# FastAPI app
# ---------------------------------------------------------------------------

app = FastAPI(
    title="AkisCFD",
    description=(
        "Cloud-based CFD simulation platform powered by OpenFOAM — "
        "Turkey's first open-source aerodynamic analysis SaaS.\n\n"
        "Upload a 3D STL/OBJ/STEP geometry, configure wind parameters, and receive "
        "drag/lift coefficients, pressure maps, and streamline visualisations."
    ),
    version=settings.APP_VERSION,
    docs_url="/api/docs",
    redoc_url="/api/redoc",
    openapi_url="/api/openapi.json",
    lifespan=lifespan,
)

# ---------------------------------------------------------------------------
# CORS
# ---------------------------------------------------------------------------

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---------------------------------------------------------------------------
# Routers
# ---------------------------------------------------------------------------

app.include_router(auth_router.router, prefix="/api")
app.include_router(upload.router,     prefix="/api")
app.include_router(simulation.router, prefix="/api")
app.include_router(results.router,    prefix="/api")

# ---------------------------------------------------------------------------
# Health check  (must be before static file mounts to avoid shadowing)
# ---------------------------------------------------------------------------

@app.get("/api/health", tags=["health"])
async def health_check():
    """Returns service health status."""
    try:
        import redis
        r = redis.from_url(settings.REDIS_URL)
        r.ping()
        redis_ok = True
    except Exception:
        redis_ok = False

    import shutil
    return {
        "status": "ok",
        "version": settings.APP_VERSION,
        "redis": "connected" if redis_ok else "disconnected",
        "openfoam": "available" if shutil.which("simpleFoam") else "not installed (mock mode)",
        "upload_dir": str(settings.UPLOAD_DIR),
        "simulations_dir": str(settings.SIMULATIONS_DIR),
    }


# ---------------------------------------------------------------------------
# Global exception handler
# ---------------------------------------------------------------------------

@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    logger.exception("Unhandled error: %s %s – %s", request.method, request.url, exc)
    return JSONResponse(
        status_code=500,
        content={"detail": "Internal server error. Please check server logs."},
    )


# ---------------------------------------------------------------------------
# Static files (frontend build + VTK result files)
# ---------------------------------------------------------------------------

# Serve VTK results as static files under /api/results/static/
RESULTS_DIR = settings.SIMULATIONS_DIR / "results"
RESULTS_DIR.mkdir(parents=True, exist_ok=True)
app.mount(
    "/api/results/static",
    StaticFiles(directory=str(RESULTS_DIR)),
    name="vtk_results",
)

# Catch-all: serve built frontend.  Must be last so API routes aren't shadowed.
STATIC_DIR = Path(__file__).parent.parent.parent / "frontend" / "dist"
if STATIC_DIR.exists():
    app.mount("/", StaticFiles(directory=str(STATIC_DIR), html=True), name="frontend")
    logger.info("Serving frontend static files from %s", STATIC_DIR)
else:
    logger.info("Frontend dist not found – API-only mode")
