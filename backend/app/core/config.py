"""
Core configuration for the CFD Web Application.
Reads settings from environment variables with sensible defaults.
"""
import os
from pathlib import Path


class Settings:
    # Application
    APP_NAME: str = "AkisCFD"
    APP_VERSION: str = "1.0.0"
    DEBUG: bool = os.getenv("DEBUG", "false").lower() == "true"

    # Paths
    BASE_DIR: Path = Path(__file__).resolve().parent.parent.parent.parent
    UPLOAD_DIR: Path = Path(os.getenv("UPLOAD_DIR", "/tmp/cfd_uploads"))
    SIMULATIONS_DIR: Path = Path(os.getenv("SIMULATIONS_DIR", "/tmp/cfd_simulations"))
    OPENFOAM_TEMPLATES_DIR: Path = BASE_DIR / "simulations" / "openfoam" / "templates"

    # Redis / Celery
    REDIS_URL: str = os.getenv("REDIS_URL", "redis://localhost:6379/0")
    CELERY_BROKER_URL: str = os.getenv("CELERY_BROKER_URL", "redis://localhost:6379/0")
    CELERY_RESULT_BACKEND: str = os.getenv("CELERY_RESULT_BACKEND", "redis://localhost:6379/1")

    # OpenFOAM
    OPENFOAM_VERSION: str = os.getenv("OPENFOAM_VERSION", "v2312")
    OPENFOAM_DIR: str = os.getenv("OPENFOAM_DIR", "/usr/lib/openfoam/openfoam2312")
    # Source this file before running any OpenFOAM command
    OPENFOAM_BASHRC: str = os.getenv(
        "OPENFOAM_BASHRC",
        "/usr/lib/openfoam/openfoam2312/etc/bashrc"
    )

    # Simulation limits
    MAX_UPLOAD_SIZE_MB: int = int(os.getenv("MAX_UPLOAD_SIZE_MB", "100"))
    MAX_CONCURRENT_JOBS: int = int(os.getenv("MAX_CONCURRENT_JOBS", "4"))
    JOB_TIMEOUT_SECONDS: int = int(os.getenv("JOB_TIMEOUT_SECONDS", "3600"))

    # CORS
    CORS_ORIGINS: list = os.getenv(
        "CORS_ORIGINS", "http://localhost:5173,http://localhost:3000"
    ).split(",")

    def ensure_dirs(self):
        self.UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
        self.SIMULATIONS_DIR.mkdir(parents=True, exist_ok=True)


settings = Settings()
settings.ensure_dirs()
