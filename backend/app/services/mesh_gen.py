"""
Mesh generation service using Gmsh Python API.

Workflow:
  1. Import STL surface geometry as a discrete entity.
  2. Classify surfaces and create volume via reparametrization.
  3. Define a surrounding wind-tunnel box.
  4. Boolean subtract the body from the box to get the fluid domain.
  5. Generate 3D Delaunay + boundary layer mesh.
  6. Export as OpenFOAM mesh (via meshio) or as .msh for conversion.

If Gmsh is unavailable at runtime the code falls back to a stub that
generates a simple blockMesh-only OpenFOAM case (useful for CI/testing).
"""
from __future__ import annotations

import logging
import math
import subprocess
from pathlib import Path
from typing import Tuple

logger = logging.getLogger(__name__)

# Mesh resolution parameters per quality level
MESH_PARAMS = {
    "coarse":  {"lc_far": 2.0,  "lc_near": 0.2,  "bl_layers": 3,  "bl_thickness": 0.05},
    "medium":  {"lc_far": 1.0,  "lc_near": 0.1,  "bl_layers": 5,  "bl_thickness": 0.02},
    "fine":    {"lc_far": 0.5,  "lc_near": 0.05, "bl_layers": 8,  "bl_thickness": 0.01},
}

# Wind tunnel box dimensions relative to the geometry bounding box
BOX_UPSTREAM   = 3.0   # multiples of max dimension
BOX_DOWNSTREAM = 8.0
BOX_LATERAL    = 3.0
BOX_HEIGHT     = 3.0


def generate_mesh(
    stl_path: Path,
    case_dir: Path,
    mesh_quality: str = "medium",
) -> Path:
    """
    Generate an OpenFOAM-compatible mesh for external aerodynamics.

    Parameters
    ----------
    stl_path     : Path to the uploaded STL file.
    case_dir     : OpenFOAM case directory (constant/polyMesh will be created here).
    mesh_quality : One of "coarse", "medium", "fine".

    Returns
    -------
    Path to the generated .msh file (Gmsh format 2).
    """
    try:
        import gmsh  # type: ignore
        return _generate_with_gmsh(stl_path, case_dir, mesh_quality, gmsh)
    except ImportError:
        logger.warning("gmsh not installed – falling back to blockMesh stub")
        return _generate_blockmesh_fallback(stl_path, case_dir, mesh_quality)


# ---------------------------------------------------------------------------
# Gmsh-based generation
# ---------------------------------------------------------------------------

def _generate_with_gmsh(
    stl_path: Path,
    case_dir: Path,
    mesh_quality: str,
    gmsh,
) -> Path:
    params = MESH_PARAMS.get(mesh_quality, MESH_PARAMS["medium"])
    lc_far = params["lc_far"]
    lc_near = params["lc_near"]
    bl_layers = params["bl_layers"]
    bl_thickness = params["bl_thickness"]

    gmsh.initialize()
    gmsh.option.setNumber("General.Terminal", 1)
    gmsh.option.setNumber("Mesh.Algorithm3D", 4)   # Frontal-Delaunay
    gmsh.option.setNumber("Mesh.CharacteristicLengthMin", lc_near * 0.5)
    gmsh.option.setNumber("Mesh.CharacteristicLengthMax", lc_far)
    gmsh.model.add("cfd_domain")

    # --- Import STL as discrete surface ---
    gmsh.merge(str(stl_path))
    gmsh.model.mesh.classifySurfaces(
        math.pi / 4,  # angle threshold for feature edges
        True,         # boundary only
        True,         # forReparametrization
        math.pi / 2,
    )
    gmsh.model.mesh.createGeometry()

    # Bounding box of the geometry
    xmin, ymin, zmin, xmax, ymax, zmax = gmsh.model.getBoundingBox(-1, -1)
    dx = xmax - xmin
    dy = ymax - ymin
    dz = zmax - zmin
    max_dim = max(dx, dy, dz)

    cx = (xmin + xmax) / 2
    cy = (ymin + ymax) / 2
    cz = (zmin + zmax) / 2

    # --- Create wind-tunnel box ---
    bx_min = xmin - BOX_UPSTREAM   * max_dim
    bx_max = xmax + BOX_DOWNSTREAM * max_dim
    by_min = cy   - BOX_LATERAL    * max_dim
    by_max = cy   + BOX_LATERAL    * max_dim
    bz_min = zmin
    bz_max = zmax + BOX_HEIGHT     * max_dim

    box = gmsh.model.occ.addBox(
        bx_min, by_min, bz_min,
        bx_max - bx_min, by_max - by_min, bz_max - bz_min,
    )

    # Synchronise before boolean ops
    gmsh.model.occ.synchronize()

    # Get all surfaces from the imported STL
    all_surfs = gmsh.model.getEntities(2)
    stl_surfaces = [(2, s[1]) for s in all_surfs if s[1] != box]

    # Fragment (boolean) to embed geometry inside box
    gmsh.model.occ.fragment([(3, box)], stl_surfaces)
    gmsh.model.occ.synchronize()

    # --- Assign mesh sizes via distance fields ---
    body_surfs = [s[1] for s in gmsh.model.getEntities(2) if s[1] != box]
    f_dist = gmsh.model.mesh.field.add("Distance")
    gmsh.model.mesh.field.setNumbers(f_dist, "SurfacesList", body_surfs)

    f_thresh = gmsh.model.mesh.field.add("Threshold")
    gmsh.model.mesh.field.setNumber(f_thresh, "InField", f_dist)
    gmsh.model.mesh.field.setNumber(f_thresh, "SizeMin", lc_near)
    gmsh.model.mesh.field.setNumber(f_thresh, "SizeMax", lc_far)
    gmsh.model.mesh.field.setNumber(f_thresh, "DistMin", lc_near * 2)
    gmsh.model.mesh.field.setNumber(f_thresh, "DistMax", lc_far * 5)
    gmsh.model.mesh.field.setAsBackgroundMesh(f_thresh)

    # --- Boundary layer ---
    bl = gmsh.model.mesh.field.add("BoundaryLayer")
    gmsh.model.mesh.field.setNumbers(bl, "CurvesList", [])
    gmsh.model.mesh.field.setNumbers(bl, "FanPointsList", [])
    gmsh.model.mesh.field.setNumber(bl, "Size", bl_thickness)
    gmsh.model.mesh.field.setNumber(bl, "Ratio", 1.3)
    gmsh.model.mesh.field.setNumber(bl, "Quads", 1)
    gmsh.model.mesh.field.setNumber(bl, "NbLayers", bl_layers)

    # --- Generate 3-D mesh ---
    gmsh.model.mesh.generate(3)
    gmsh.model.mesh.optimize("Netgen")

    msh_path = case_dir / "geometry.msh"
    gmsh.write(str(msh_path))
    gmsh.finalize()

    logger.info("Gmsh mesh written to %s", msh_path)
    return msh_path


# ---------------------------------------------------------------------------
# Fallback: pure blockMesh (no body fitted, for testing only)
# ---------------------------------------------------------------------------

def _generate_blockmesh_fallback(
    stl_path: Path,
    case_dir: Path,
    mesh_quality: str,
) -> Path:
    """Write a simple blockMeshDict and run blockMesh."""
    n = {"coarse": 20, "medium": 40, "fine": 80}.get(mesh_quality, 40)

    block_mesh_dict = f"""\
FoamFile
{{
    version     2.0;
    format      ascii;
    class       dictionary;
    object      blockMeshDict;
}}

scale 1;

vertices
(
    (-10 -5 -5)
    ( 25 -5 -5)
    ( 25  5 -5)
    (-10  5 -5)
    (-10 -5  5)
    ( 25 -5  5)
    ( 25  5  5)
    (-10  5  5)
);

blocks
(
    hex (0 1 2 3 4 5 6 7) ({n} {n//2} {n//2}) simpleGrading (1 1 1)
);

edges ();

boundary
(
    inlet
    {{
        type patch;
        faces ((0 4 7 3));
    }}
    outlet
    {{
        type patch;
        faces ((1 2 6 5));
    }}
    top
    {{
        type symmetryPlane;
        faces ((3 7 6 2));
    }}
    bottom
    {{
        type symmetryPlane;
        faces ((0 1 5 4));
    }}
    frontAndBack
    {{
        type symmetryPlane;
        faces
        (
            (4 5 6 7)
            (0 3 2 1)
        );
    }}
);
"""
    block_mesh_path = case_dir / "system" / "blockMeshDict"
    block_mesh_path.parent.mkdir(parents=True, exist_ok=True)
    block_mesh_path.write_text(block_mesh_dict)

    # blockMesh will be run as part of the OpenFOAM runner pipeline
    stub_msh = case_dir / "geometry.msh"
    stub_msh.write_text("# blockMesh fallback – no .msh file produced\n")
    return stub_msh


# ---------------------------------------------------------------------------
# Helper: convert Gmsh .msh → OpenFOAM polyMesh via gmshToFoam
# ---------------------------------------------------------------------------

def convert_msh_to_foam(msh_path: Path, case_dir: Path, openfoam_bashrc: str) -> None:
    """Run gmshToFoam to convert the .msh file into an OpenFOAM polyMesh."""
    cmd = (
        f"source {openfoam_bashrc} && "
        f"cd {case_dir} && "
        f"gmshToFoam {msh_path}"
    )
    result = subprocess.run(
        ["bash", "-c", cmd],
        capture_output=True,
        text=True,
        timeout=300,
    )
    if result.returncode != 0:
        raise RuntimeError(
            f"gmshToFoam failed:\nSTDOUT: {result.stdout}\nSTDERR: {result.stderr}"
        )
    logger.info("gmshToFoam conversion successful")
