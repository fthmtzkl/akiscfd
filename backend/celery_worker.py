"""
Celery worker entry-point.

Start with:
    source /usr/lib/openfoam/openfoam2312/etc/bashrc
    celery -A celery_worker worker --loglevel=info --queues=cfd_simulations
"""
from app.celery_app import celery_app  # noqa: F401
