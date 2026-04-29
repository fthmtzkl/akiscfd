"""
Pydantic models / schemas for request and response objects.
"""
from __future__ import annotations

import uuid
from datetime import datetime
from enum import Enum
from typing import Dict, List, Optional

from pydantic import BaseModel, Field, field_validator


# ---------------------------------------------------------------------------
# Enumerations
# ---------------------------------------------------------------------------

class TurbulenceModel(str, Enum):
    k_epsilon = "kEpsilon"
    k_omega_sst = "kOmegaSST"


class MeshQuality(str, Enum):
    coarse = "coarse"
    medium = "medium"
    fine = "fine"


class JobStatus(str, Enum):
    pending = "pending"
    preprocessing = "preprocessing"
    meshing = "meshing"
    running = "running"
    postprocessing = "postprocessing"
    completed = "completed"
    failed = "failed"


# ---------------------------------------------------------------------------
# Upload
# ---------------------------------------------------------------------------

class GeometryUploadResponse(BaseModel):
    geometry_id: str
    filename: str
    file_size_bytes: int
    message: str


# ---------------------------------------------------------------------------
# Simulation request / response
# ---------------------------------------------------------------------------

class SimulationRequest(BaseModel):
    geometry_id: str = Field(..., description="ID returned by the upload endpoint")
    wind_speed: float = Field(
        20.0, ge=1.0, le=100.0, description="Inlet wind speed in m/s"
    )
    wind_angle_deg: float = Field(
        0.0, ge=0.0, lt=360.0, description="Wind direction in degrees (0 = +X axis)"
    )
    turbulence_model: TurbulenceModel = TurbulenceModel.k_omega_sst
    mesh_quality: MeshQuality = MeshQuality.medium
    num_iterations: int = Field(500, ge=50, le=2000)

    @field_validator("wind_angle_deg", mode="before")
    @classmethod
    def angle_in_range(cls, v: float) -> float:
        return float(v) % 360.0


class SimulationResponse(BaseModel):
    job_id: str
    status: JobStatus
    message: str
    created_at: datetime = Field(default_factory=datetime.utcnow)


# ---------------------------------------------------------------------------
# Job status / results
# ---------------------------------------------------------------------------

class ResidualPoint(BaseModel):
    iteration: int
    Ux: Optional[float] = None
    Uy: Optional[float] = None
    Uz: Optional[float] = None
    p: Optional[float] = None
    k: Optional[float] = None
    omega: Optional[float] = None
    epsilon: Optional[float] = None


class ForceCoefficients(BaseModel):
    Cd: float = Field(..., description="Drag coefficient")
    Cl: float = Field(..., description="Lift coefficient")
    Cs: float = Field(0.0, description="Side force coefficient")
    Cf: float = Field(0.0, description="Mean skin friction coefficient")
    frontal_area_m2: Optional[float] = None
    reference_velocity_ms: Optional[float] = None
    drag_force_n: Optional[float] = None
    lift_force_n: Optional[float] = None


class SimulationResults(BaseModel):
    job_id: str
    status: JobStatus
    request: Optional[SimulationRequest] = None
    force_coefficients: Optional[ForceCoefficients] = None
    residuals: Optional[List[ResidualPoint]] = None
    # URLs to downloadable VTK files for frontend rendering
    vtk_surface_url: Optional[str] = None
    vtk_volume_url: Optional[str] = None
    streamlines_url: Optional[str] = None
    # Scalar stats
    pressure_min_pa: Optional[float] = None
    pressure_max_pa: Optional[float] = None
    velocity_max_ms: Optional[float] = None
    noise_spl_db: Optional[float] = None
    surface_area_m2: Optional[float] = None
    reynolds_number: Optional[float] = None
    error_message: Optional[str] = None
    started_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None


class JobStatusResponse(BaseModel):
    job_id: str
    status: JobStatus
    progress_percent: int = Field(0, ge=0, le=100)
    current_step: str = ""
    error_message: Optional[str] = None
    results: Optional[SimulationResults] = None


# ---------------------------------------------------------------------------
# Mesh info
# ---------------------------------------------------------------------------

class MeshInfo(BaseModel):
    n_cells: int
    n_faces: int
    n_points: int
    bounding_box: Dict[str, float]  # xmin, xmax, ymin, ymax, zmin, zmax
