"""
Upload router – handles geometry file uploads (STL / OBJ / STEP).
"""
from __future__ import annotations

import hashlib
import logging
import uuid
from pathlib import Path

from fastapi import APIRouter, File, HTTPException, UploadFile, status
from fastapi.responses import FileResponse

from ..core.config import settings
from ..models.schemas import GeometryUploadResponse

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/upload", tags=["upload"])

ALLOWED_EXTENSIONS = {".stl", ".obj", ".step", ".stp"}
MAX_BYTES = settings.MAX_UPLOAD_SIZE_MB * 1024 * 1024


@router.post(
    "/geometry",
    response_model=GeometryUploadResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Upload a 3D geometry file (STL preferred)",
)
async def upload_geometry(file: UploadFile = File(...)):
    """
    Accept a 3D geometry file and save it to the upload directory.

    Returns a `geometry_id` that must be passed to `POST /simulate`.

    Supported formats: STL, OBJ, STEP/STP.
    Maximum file size: configured via `MAX_UPLOAD_SIZE_MB` (default 100 MB).
    """
    # Validate extension
    suffix = Path(file.filename or "geometry.stl").suffix.lower()
    if suffix not in ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail=f"Unsupported file type '{suffix}'. Allowed: {ALLOWED_EXTENSIONS}",
        )

    # Read file content with size guard
    content = await file.read(MAX_BYTES + 1)
    if len(content) > MAX_BYTES:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=f"File too large. Maximum size is {settings.MAX_UPLOAD_SIZE_MB} MB.",
        )

    geometry_id = str(uuid.uuid4())
    dest_path = settings.UPLOAD_DIR / f"{geometry_id}{suffix}"
    dest_path.write_bytes(content)

    logger.info(
        "Geometry uploaded: id=%s file=%s size=%d bytes",
        geometry_id,
        file.filename,
        len(content),
    )

    return GeometryUploadResponse(
        geometry_id=geometry_id,
        filename=file.filename or f"geometry{suffix}",
        file_size_bytes=len(content),
        message="Geometry uploaded successfully. Use the geometry_id to start a simulation.",
    )


@router.get(
    "/geometry/{geometry_id}/file",
    summary="Download the raw geometry file (STL/OBJ/STEP)",
    response_class=FileResponse,
)
async def get_geometry_file(geometry_id: str):
    """Serve the uploaded geometry file for browser-side 3D preview."""
    matches = list(settings.UPLOAD_DIR.glob(f"{geometry_id}.*"))
    if not matches:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Geometry '{geometry_id}' not found.",
        )
    file_path = matches[0]
    return FileResponse(
        path=str(file_path),
        media_type="application/octet-stream",
        filename=file_path.name,
        headers={"Access-Control-Allow-Origin": "*"},
    )


@router.delete(
    "/geometry/{geometry_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Delete an uploaded geometry file",
)
async def delete_geometry(geometry_id: str):
    """Remove a previously uploaded geometry file."""
    # Find the file regardless of extension
    matches = list(settings.UPLOAD_DIR.glob(f"{geometry_id}.*"))
    if not matches:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Geometry '{geometry_id}' not found.",
        )
    for f in matches:
        f.unlink(missing_ok=True)
    logger.info("Deleted geometry %s", geometry_id)
