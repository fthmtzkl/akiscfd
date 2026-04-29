#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# run_simulation.sh  –  Manual runner for a prepared OpenFOAM case
#
# Usage:
#   ./run_simulation.sh <case_dir> [n_processors]
#
# Example:
#   ./run_simulation.sh /tmp/cfd_simulations/abc-123 4
#
# Environment:
#   OPENFOAM_BASHRC  – path to the OpenFOAM bashrc (defaults to v2312 location)
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

CASE_DIR="${1:?Usage: $0 <case_dir> [n_processors]}"
N_PROC="${2:-1}"
OPENFOAM_BASHRC="${OPENFOAM_BASHRC:-/usr/lib/openfoam/openfoam2312/etc/bashrc}"

echo "============================================================"
echo " CFD Simulation Runner"
echo " Case    : ${CASE_DIR}"
echo " CPUs    : ${N_PROC}"
echo " OpenFOAM: ${OPENFOAM_BASHRC}"
echo "============================================================"

# Source OpenFOAM environment
# shellcheck disable=SC1090
source "${OPENFOAM_BASHRC}"

cd "${CASE_DIR}"

# ─── 1. Background mesh ────────────────────────────────────────────────────
echo "[1/7] Running blockMesh..."
blockMesh 2>&1 | tee log.blockMesh

# ─── 2. Feature extraction ─────────────────────────────────────────────────
echo "[2/7] Extracting surface features..."
surfaceFeatureExtract 2>&1 | tee log.surfaceFeatureExtract

# ─── 3. Snappy hex mesh ────────────────────────────────────────────────────
echo "[3/7] Running snappyHexMesh..."
if [ "${N_PROC}" -gt 1 ]; then
    decomposePar -noFields 2>&1 | tee log.decomposePar
    mpirun -np "${N_PROC}" snappyHexMesh -parallel -overwrite 2>&1 | tee log.snappyHexMesh
    reconstructParMesh -constant 2>&1 | tee log.reconstructParMesh
    rm -rf processor*/
else
    snappyHexMesh -overwrite 2>&1 | tee log.snappyHexMesh
fi

# ─── 4. Check mesh quality ─────────────────────────────────────────────────
echo "[4/7] Checking mesh quality..."
checkMesh 2>&1 | tee log.checkMesh

# ─── 5. Decompose (parallel solve) ─────────────────────────────────────────
if [ "${N_PROC}" -gt 1 ]; then
    echo "[5/7] Decomposing domain for ${N_PROC} processors..."
    decomposePar 2>&1 | tee log.decomposePar
fi

# ─── 6. Solve ──────────────────────────────────────────────────────────────
echo "[6/7] Running simpleFoam..."
if [ "${N_PROC}" -gt 1 ]; then
    mpirun -np "${N_PROC}" simpleFoam -parallel 2>&1 | tee log.simpleFoam
    reconstructPar 2>&1 | tee log.reconstructPar
    rm -rf processor*/
else
    simpleFoam 2>&1 | tee log.simpleFoam
fi

# ─── 7. Post-processing ────────────────────────────────────────────────────
echo "[7/7] Running post-processing..."
postProcess -func forceCoeffs 2>&1 | tee log.postProcess || true
postProcess -func yPlus       2>&1 | tee log.yPlus        || true

echo ""
echo "============================================================"
echo " Simulation complete!"
echo " Results in: ${CASE_DIR}"
echo "============================================================"
