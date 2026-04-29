# ─────────────────────────────────────────────────────────────────────────────
# CFD Web App – Backend Docker Image
#
# Base: official OpenFOAM v2312 image (ESI/OpenCFD)
# Adds: Python 3.11 + FastAPI + Celery + Gmsh + pyvista
# ─────────────────────────────────────────────────────────────────────────────
FROM opencfd/openfoam-run:2312

ENV DEBIAN_FRONTEND=noninteractive
ENV TZ=UTC
ENV OPENFOAM_DIR=/usr/lib/openfoam/openfoam2312
ENV OPENFOAM_BASHRC=${OPENFOAM_DIR}/etc/bashrc

# ---------------------------------------------------------------------------
# System packages – Python 3.11 + build tools + GL libs for pyvista headless
# ---------------------------------------------------------------------------
RUN apt-get update && apt-get install -y --no-install-recommends \
    software-properties-common \
    curl wget git ca-certificates \
    python3.11 python3.11-dev python3.11-venv python3-pip \
    build-essential cmake \
    libopenmpi-dev openmpi-bin \
    libgl1-mesa-glx libglu1-mesa libxrender1 libxext6 xvfb \
    libxcursor1 libxinerama1 libxi6 libxrandr2 \
    && rm -rf /var/lib/apt/lists/*

# ---------------------------------------------------------------------------
# Python virtual environment
# ---------------------------------------------------------------------------
ENV VENV_PATH=/opt/venv
RUN python3.11 -m venv ${VENV_PATH}
ENV PATH="${VENV_PATH}/bin:${PATH}"

# ---------------------------------------------------------------------------
# Python dependencies
# ---------------------------------------------------------------------------
WORKDIR /app
COPY requirements.txt .

RUN pip install --upgrade pip setuptools wheel && \
    pip install --no-cache-dir -r requirements.txt && \
    pip install --no-cache-dir gmsh || echo "gmsh not available for this arch – using snappyHexMesh" && \
    pip install --no-cache-dir pyvista || echo "pyvista not available – VTK export disabled" && \
    pip install --no-cache-dir foamlib || echo "foamlib not available – skipping"

# ---------------------------------------------------------------------------
# Application code
# ---------------------------------------------------------------------------
COPY . /app

RUN mkdir -p /tmp/cfd_uploads /tmp/cfd_simulations/results

# ---------------------------------------------------------------------------
# Entrypoint – source OpenFOAM then start FastAPI
# ---------------------------------------------------------------------------
EXPOSE 8000

ENV PYTHONPATH=/app

CMD ["bash", "-c", \
     "source /usr/lib/openfoam/openfoam2312/etc/bashrc && \
      cd /app && uvicorn app.main:app --host 0.0.0.0 --port 8000 --workers 4"]
