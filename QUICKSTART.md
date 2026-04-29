# CFD Web App – Quick Start Guide

AirShaper benzeri, tamamen açık kaynak CFD simülasyon web uygulaması.

## Gereksinimler

- Docker 24+ ve Docker Compose v2
- (Opsiyonel, native çalıştırma için) Ubuntu 22.04, OpenFOAM v2312, Python 3.11+

---

## 1. Docker ile Başlatma (Önerilen)

```bash
cd /Users/fozkul/Projects/cfd-web-app/backend
docker compose up --build
```

Servisler:
| Servis | URL |
|--------|-----|
| FastAPI backend | http://localhost:8000 |
| Swagger UI | http://localhost:8000/api/docs |
| React frontend | http://localhost:5173 |
| Celery Flower | http://localhost:5555 |

---

## 2. Native Kurulum (macOS / Ubuntu)

### Backend

```bash
# OpenFOAM kurulu olduğu varsayılır
cd backend
python3.11 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
pip install gmsh pyvista

# Redis başlat
redis-server &

# FastAPI başlat
uvicorn app.main:app --reload --port 8000

# Celery worker (ayrı terminal)
source /usr/lib/openfoam/openfoam2312/etc/bashrc
celery -A celery_worker worker --loglevel=info --queues=cfd_simulations
```

### Frontend

```bash
cd frontend
npm install
npm run dev
```

---

## 3. Kullanım Akışı

1. **http://localhost:5173** adresini aç
2. STL dosyasını sürükle-bırak ile yükle
3. Rüzgar hızı, açı, türbülans modeli ve mesh kalitesini ayarla
4. **Run Simulation** butonuna tıkla
5. Gerçek zamanlı progress takibi
6. Cd / Cl katsayıları, basınç dağılımı ve streamline görselleştirmesi

---

## 4. API Kullanımı

```bash
# Geometri yükle
curl -X POST http://localhost:8000/api/upload/geometry \
  -F "file=@my_car.stl"
# → {"geometry_id": "abc-123", ...}

# Simülasyon başlat
curl -X POST http://localhost:8000/api/simulate \
  -H "Content-Type: application/json" \
  -d '{
    "geometry_id": "abc-123",
    "wind_speed": 30,
    "wind_angle_deg": 0,
    "turbulence_model": "kOmegaSST",
    "mesh_quality": "medium",
    "num_iterations": 500
  }'
# → {"job_id": "xyz-789", "status": "pending"}

# Durum sorgula
curl http://localhost:8000/api/simulate/xyz-789/status

# Sonuçları al (tamamlandıktan sonra)
curl http://localhost:8000/api/results/xyz-789
```

---

## 5. Proje Yapısı

```
cfd-web-app/
├── backend/
│   ├── app/
│   │   ├── main.py               # FastAPI app + CORS + static files
│   │   ├── celery_app.py         # Celery task definitions
│   │   ├── routers/
│   │   │   ├── upload.py         # POST /api/upload/geometry
│   │   │   ├── simulation.py     # POST /api/simulate + SSE stream
│   │   │   └── results.py        # GET /api/results/{job_id}
│   │   ├── services/
│   │   │   ├── cfd_runner.py     # OpenFOAM pipeline orchestrator
│   │   │   ├── mesh_gen.py       # Gmsh mesh generation
│   │   │   └── post_process.py   # Results parsing + VTK conversion
│   │   ├── models/schemas.py     # Pydantic models
│   │   └── core/config.py        # Settings (env vars)
│   ├── Dockerfile                # OpenFOAM + Python image
│   ├── docker-compose.yml        # Full stack (api + worker + redis + frontend)
│   └── requirements.txt
├── frontend/
│   ├── src/
│   │   ├── App.jsx               # Main layout
│   │   ├── components/
│   │   │   ├── GeometryUploader.jsx  # Drag & drop STL upload
│   │   │   ├── SimulationConfig.jsx  # Wind params + mesh quality
│   │   │   ├── JobStatus.jsx         # SSE-based live progress
│   │   │   ├── ResultsViewer.jsx     # Cd/Cl + residuals + 3D tab
│   │   │   └── Viewer3D.jsx          # vtk.js 3D pressure visualiser
│   │   └── services/api.js       # Axios + EventSource wrappers
│   └── package.json
└── simulations/
    ├── openfoam/
    │   ├── templates/            # OpenFOAM case template (0/, constant/, system/)
    │   └── run_simulation.sh     # Manual runner script
    └── gmsh/
        └── generate_mesh.py     # Standalone mesh generator CLI
```

---

## 6. Turbülans Modeli Seçimi

| Model | Ne Zaman Kullan |
|-------|-----------------|
| k-ω SST | Dış aerodinamik (araç, kanat profili) – önerilen |
| k-ε | Kapalı alan akışları, hızlı prototipleme |

---

## 7. Mesh Kalite Kılavuzu

| Kalite | Hücre Sayısı | Süre | Kullanım |
|--------|-------------|------|---------|
| Coarse | ~500K | ~10 dk | İlk konsept testi |
| Medium | ~2M | ~30 dk | Tasarım doğrulama |
| Fine | ~8M | ~90 dk | Final analiz |
