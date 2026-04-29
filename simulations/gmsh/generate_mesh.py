#!/usr/bin/env python3
"""
Gmsh External Aerodynamics Mesh Generator
==========================================

Standalone script to generate a 3D mesh for external aerodynamics
given an STL surface geometry and output an OpenFOAM-compatible mesh.

Usage
-----
    python generate_mesh.py geometry.stl ./case_dir --quality medium

The script produces:
    case_dir/geometry.msh          – Gmsh 2.2 format mesh
    case_dir/constant/polyMesh/    – OpenFOAM polyMesh (via gmshToFoam)

Requirements
------------
    pip install gmsh meshio numpy
    OpenFOAM environment sourced (for gmshToFoam conversion step)
"""
from __future__ import annotations

import argparse
import logging
import math
import os
import subprocess
import sys
from pathlib import Path

import gmsh
import numpy as np

logging.basicConfig(level=logging.INFO, format="%(levelname)s  %(message)s")
logger = logging.getLogger(__name__)

# ─────────────────────────────────────────────────────────────────────────────
# Mesh quality presets
# ─────────────────────────────────────────────────────────────────────────────
PRESETS = {
    "coarse": {
        "lc_far":        2.0,
        "lc_near":       0.2,
        "bl_layers":     3,
        "bl_thickness":  0.05,
        "bl_ratio":      1.3,
    },
    "medium": {
        "lc_far":        1.0,
        "lc_near":       0.1,
        "bl_layers":     5,
        "bl_thickness":  0.02,
        "bl_ratio":      1.3,
    },
    "fine": {
        "lc_far":        0.5,
        "lc_near":       0.05,
        "bl_layers":     8,
        "bl_thickness":  0.01,
        "bl_ratio":      1.25,
    },
}

# Wind-tunnel proportions relative to the geometry's max bounding dimension
BOX_UPSTREAM   = 3.0
BOX_DOWNSTREAM = 8.0
BOX_LATERAL    = 3.0
BOX_HEIGHT     = 3.0


# ─────────────────────────────────────────────────────────────────────────────
# Main mesh generation function
# ─────────────────────────────────────────────────────────────────────────────

def generate_external_aero_mesh(
    stl_path: Path,
    output_dir: Path,
    quality: str = "medium",
    angle_threshold_deg: float = 40.0,
    convert_to_foam: bool = True,
    openfoam_bashrc: str = "/usr/lib/openfoam/openfoam2312/etc/bashrc",
) -> Path:
    """
    Generate an external aerodynamics mesh from an STL surface.

    Parameters
    ----------
    stl_path          : Path to the input STL file.
    output_dir        : Directory where geometry.msh (and polyMesh) will be written.
    quality           : "coarse", "medium", or "fine".
    angle_threshold_deg : Feature edge detection angle (degrees).
    convert_to_foam   : If True, run gmshToFoam after mesh generation.
    openfoam_bashrc   : Path to OpenFOAM environment script.

    Returns
    -------
    Path to the generated .msh file.
    """
    output_dir.mkdir(parents=True, exist_ok=True)
    p = PRESETS.get(quality, PRESETS["medium"])

    # ── Initialise Gmsh ────────────────────────────────────────────────────
    gmsh.initialize()
    gmsh.option.setNumber("General.Terminal", 1)
    gmsh.option.setNumber("General.Verbosity", 4)
    gmsh.model.add("external_aero")

    # ── Mesh quality options ───────────────────────────────────────────────
    gmsh.option.setNumber("Mesh.Algorithm3D", 4)         # Frontal-Delaunay 3D
    gmsh.option.setNumber("Mesh.OptimizeNetgen", 1)
    gmsh.option.setNumber("Mesh.CharacteristicLengthMin", p["lc_near"] * 0.3)
    gmsh.option.setNumber("Mesh.CharacteristicLengthMax", p["lc_far"])
    gmsh.option.setNumber("Mesh.CharacteristicLengthFromPoints", 1)
    gmsh.option.setNumber("Mesh.CharacteristicLengthExtendFromBoundary", 1)

    # ── Import STL as discrete surface ─────────────────────────────────────
    logger.info("Importing STL: %s", stl_path)
    gmsh.merge(str(stl_path))

    # Classify mesh surfaces to identify feature edges
    angle_rad = math.radians(angle_threshold_deg)
    gmsh.model.mesh.classifySurfaces(
        angle_rad,      # angle threshold for feature edges
        True,           # boundary
        True,           # forReparametrization
        math.pi / 2,    # angle for periodic surfaces
    )
    gmsh.model.mesh.createGeometry()

    # ── Get bounding box ───────────────────────────────────────────────────
    xmin, ymin, zmin, xmax, ymax, zmax = gmsh.model.getBoundingBox(-1, -1)
    dx = xmax - xmin
    dy = ymax - ymin
    dz = zmax - zmin
    max_dim = max(dx, dy, dz)

    logger.info(
        "Geometry bounds: x=[%.3f, %.3f]  y=[%.3f, %.3f]  z=[%.3f, %.3f]",
        xmin, xmax, ymin, ymax, zmin, zmax,
    )
    logger.info("Max dimension: %.3f m", max_dim)

    # ── Create wind-tunnel box ─────────────────────────────────────────────
    cx = (xmin + xmax) / 2
    cy = (ymin + ymax) / 2

    bx_min = xmin - BOX_UPSTREAM   * max_dim
    bx_max = xmax + BOX_DOWNSTREAM * max_dim
    by_min = cy   - BOX_LATERAL    * max_dim
    by_max = cy   + BOX_LATERAL    * max_dim
    bz_min = zmin
    bz_max = zmax + BOX_HEIGHT     * max_dim

    logger.info("Wind-tunnel box: [%.1f, %.1f] x [%.1f, %.1f] x [%.1f, %.1f]",
                bx_min, bx_max, by_min, by_max, bz_min, bz_max)

    box_tag = gmsh.model.occ.addBox(
        bx_min, by_min, bz_min,
        bx_max - bx_min,
        by_max - by_min,
        bz_max - bz_min,
    )
    gmsh.model.occ.synchronize()

    # ── Boolean fragment: embed geometry inside box ────────────────────────
    # Get all surface tags that belong to the imported STL (not the box)
    all_surf_tags = [e[1] for e in gmsh.model.getEntities(2)]
    # The box surfaces were created after the STL, find the box surface tags
    box_surf_tags = [e[1] for e in gmsh.model.occ.getEntities(2)
                     if e[1] not in all_surf_tags]

    stl_surf_tags = [t for t in all_surf_tags if t not in box_surf_tags]

    logger.info("Fragmenting geometry into wind-tunnel box (%d STL surfaces)...",
                len(stl_surf_tags))
    gmsh.model.occ.fragment(
        [(3, box_tag)],
        [(2, t) for t in stl_surf_tags],
    )
    gmsh.model.occ.synchronize()

    # ── Distance-based mesh size field ─────────────────────────────────────
    # After fragment, get the new surface tags belonging to the geometry
    current_surfs = [e[1] for e in gmsh.model.getEntities(2)]
    # Approximate: surfaces with bounding box similar to the original geometry
    body_surfs = _get_body_surfaces(stl_path)

    f_dist = gmsh.model.mesh.field.add("Distance")
    gmsh.model.mesh.field.setNumbers(f_dist, "SurfacesList", current_surfs[:len(stl_surf_tags)])

    f_thresh = gmsh.model.mesh.field.add("Threshold")
    gmsh.model.mesh.field.setNumber(f_thresh, "InField",  f_dist)
    gmsh.model.mesh.field.setNumber(f_thresh, "SizeMin",  p["lc_near"])
    gmsh.model.mesh.field.setNumber(f_thresh, "SizeMax",  p["lc_far"])
    gmsh.model.mesh.field.setNumber(f_thresh, "DistMin",  p["lc_near"] * 3)
    gmsh.model.mesh.field.setNumber(f_thresh, "DistMax",  p["lc_far"]  * 6)
    gmsh.model.mesh.field.setAsBackgroundMesh(f_thresh)
    gmsh.option.setNumber("Mesh.CharacteristicLengthExtendFromBoundary", 0)
    gmsh.option.setNumber("Mesh.CharacteristicLengthFromCurvature", 0)

    # ── Generate 3D mesh ───────────────────────────────────────────────────
    logger.info("Generating 3D mesh (quality=%s)...", quality)
    gmsh.model.mesh.generate(3)

    logger.info("Optimising mesh with Netgen...")
    gmsh.model.mesh.optimize("Netgen", force=True)

    # ── Statistics ─────────────────────────────────────────────────────────
    node_count    = len(gmsh.model.mesh.getNodes()[0])
    element_count = sum(len(gmsh.model.mesh.getElementsByType(t)[0])
                        for t in [2, 3, 4, 5, 6])
    logger.info("Mesh statistics: nodes=%d  elements=%d", node_count, element_count)

    # ── Export ─────────────────────────────────────────────────────────────
    msh_path = output_dir / "geometry.msh"
    gmsh.option.setNumber("Mesh.MshFileVersion", 2.2)
    gmsh.write(str(msh_path))
    logger.info("Mesh written to %s", msh_path)

    gmsh.finalize()

    # ── Convert to OpenFOAM ────────────────────────────────────────────────
    if convert_to_foam:
        _convert_to_foam(msh_path, output_dir, openfoam_bashrc)

    return msh_path


def _get_body_surfaces(stl_path: Path) -> list:
    """Try to load the STL and return an approximate surface count."""
    try:
        import meshio
        mesh = meshio.read(str(stl_path))
        return list(range(len(mesh.cells)))
    except Exception:
        return []


def _convert_to_foam(msh_path: Path, case_dir: Path, openfoam_bashrc: str) -> None:
    """Convert the .msh file to OpenFOAM polyMesh using gmshToFoam."""
    cmd = (
        f"source {openfoam_bashrc} && "
        f"cd {case_dir} && "
        f"gmshToFoam {msh_path}"
    )
    logger.info("Converting to OpenFOAM format...")
    result = subprocess.run(["bash", "-c", cmd], capture_output=True, text=True, timeout=600)
    if result.returncode != 0:
        logger.error("gmshToFoam failed:\n%s", result.stderr)
        raise RuntimeError("gmshToFoam conversion failed. Check that OpenFOAM is installed.")
    logger.info("OpenFOAM polyMesh created in %s/constant/polyMesh", case_dir)


# ─────────────────────────────────────────────────────────────────────────────
# CLI entry point
# ─────────────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(
        description="Generate external aerodynamics mesh from STL using Gmsh"
    )
    parser.add_argument("stl_path",    type=Path, help="Input STL file path")
    parser.add_argument("output_dir",  type=Path, help="Output directory (case dir)")
    parser.add_argument(
        "--quality", choices=["coarse", "medium", "fine"],
        default="medium", help="Mesh quality preset (default: medium)"
    )
    parser.add_argument(
        "--angle", type=float, default=40.0,
        help="Feature edge angle threshold in degrees (default: 40)"
    )
    parser.add_argument(
        "--no-foam", action="store_true",
        help="Skip gmshToFoam conversion step"
    )
    parser.add_argument(
        "--foam-bashrc",
        default="/usr/lib/openfoam/openfoam2312/etc/bashrc",
        help="Path to OpenFOAM bashrc (for gmshToFoam)"
    )
    args = parser.parse_args()

    if not args.stl_path.exists():
        logger.error("STL file not found: %s", args.stl_path)
        sys.exit(1)

    msh_path = generate_external_aero_mesh(
        stl_path=args.stl_path,
        output_dir=args.output_dir,
        quality=args.quality,
        angle_threshold_deg=args.angle,
        convert_to_foam=not args.no_foam,
        openfoam_bashrc=args.foam_bashrc,
    )

    print(f"\nMesh generated successfully: {msh_path}")
    if not args.no_foam:
        print(f"OpenFOAM polyMesh: {args.output_dir}/constant/polyMesh/")


if __name__ == "__main__":
    main()
