import React, { useState, Suspense, lazy } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowRight, ArrowLeft, Check, CheckCircle2, RotateCcw } from "lucide-react";
import GeometryUploader from "../components/GeometryUploader";
import SimulationConfig from "../components/SimulationConfig";

const GeometryViewer3D = lazy(() => import("../components/GeometryViewer3D"));
import { submitSimulation } from "../services/api";
import { addSimulation } from "../services/storage";

const API_BASE = import.meta.env.VITE_API_BASE_URL || "/api";

const SIM_TYPES = [
  {
    id: "external",
    emoji: "🚗",
    title: "External Aerodynamics",
    desc: "Airflow around vehicles, aircraft, buildings, cyclists, and other external shapes.",
    available: true,
  },
  {
    id: "internal",
    emoji: "🔧",
    title: "Internal Flow",
    desc: "Flow through pipes, HVAC ducts, fans, valves and other internal geometries.",
    available: false,
  },
  {
    id: "hydro",
    emoji: "🌊",
    title: "Hydrodynamics",
    desc: "Underwater vehicles, hydrofoils, marine propellers and water-based simulations.",
    available: false,
  },
];

const STEPS = ["Simulation Type", "Upload Geometry", "Configure & Run"];

export default function NewSimulation() {
  const navigate = useNavigate();
  const [step,         setStep]         = useState(0);
  const [simType,      setSimType]      = useState("external");
  const [geometryId,   setGeometryId]   = useState(null);
  const [geometryName, setGeometryName] = useState("");
  const [meshInfo,     setMeshInfo]     = useState(null);
  const [previewWind,  setPreviewWind]  = useState({ angle: 0, speed: 20 });
  const [submitting,   setSubmitting]   = useState(false);
  const [error,        setError]        = useState("");

  const handleUploaded = (id, name) => {
    setGeometryId(id);
    setGeometryName(name);
    setMeshInfo(null);
  };

  const handleReset = () => {
    setGeometryId(null);
    setGeometryName("");
    setMeshInfo(null);
  };

  const handleSubmit = async (config) => {
    setSubmitting(true);
    setError("");
    try {
      const job = await submitSimulation(config);
      addSimulation({
        jobId:            job.job_id,
        geometryId,
        geometryName,
        simulationType:   simType,
        windSpeed:        config.wind_speed,
        windAngleDeg:     config.wind_angle_deg,
        turbulenceModel:  config.turbulence_model,
        meshQuality:      config.mesh_quality,
        numIterations:    config.num_iterations,
        status:           "queued",
        createdAt:        new Date().toISOString(),
        results:          null,
      });
      navigate(`/results/${job.job_id}`);
    } catch (err) {
      setError(err.message);
      setSubmitting(false);
    }
  };

  // Wide layout when geometry viewer is visible
  const isWide = (step === 1 || step === 2) && geometryId;

  return (
    <div className="min-h-[calc(100vh-64px)] bg-slate-950">

      {/* Page header */}
      <div className="bg-slate-900 border-b border-slate-800">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6">
          <p className="text-sm text-slate-500 mb-1">
            <span
              className="hover:text-slate-300 cursor-pointer transition-colors"
              onClick={() => navigate("/")}
            >Dashboard</span>
            <span className="mx-2 text-slate-700">›</span>
            <span className="text-slate-300">New Simulation</span>
          </p>
          <h1 className="text-2xl font-extrabold text-white">Create New Simulation</h1>
        </div>
      </div>

      <div className={`mx-auto px-4 sm:px-6 py-8 transition-all duration-300 ${isWide ? "max-w-6xl" : "max-w-3xl"}`}>

        {/* Step indicator */}
        <div className="flex items-center mb-10">
          {STEPS.map((label, i) => (
            <React.Fragment key={label}>
              <div className="flex items-center gap-2.5">
                <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold transition-all ${
                  i < step  ? "bg-green-500 text-white" :
                  i === step ? "bg-blue-600 text-white ring-4 ring-blue-600/20" :
                  "bg-slate-800 text-slate-500 border border-slate-700"
                }`}>
                  {i < step ? <Check className="w-4 h-4" /> : i + 1}
                </div>
                <span className={`text-sm font-medium hidden sm:block ${
                  i === step ? "text-white" : i < step ? "text-green-400" : "text-slate-600"
                }`}>
                  {label}
                </span>
              </div>
              {i < STEPS.length - 1 && (
                <div className={`flex-1 h-px mx-4 ${i < step ? "bg-green-500" : "bg-slate-800"}`} />
              )}
            </React.Fragment>
          ))}
        </div>

        {/* ── Step 0: Type ── */}
        {step === 0 && (
          <div className="space-y-4">
            <div className="mb-6">
              <h2 className="text-xl font-bold text-white">What do you want to simulate?</h2>
              <p className="text-slate-400 text-sm mt-1">Choose the type of CFD analysis you need.</p>
            </div>

            {SIM_TYPES.map(t => (
              <button
                key={t.id}
                onClick={() => t.available && setSimType(t.id)}
                disabled={!t.available}
                className={`w-full text-left p-5 rounded-2xl border-2 transition-all ${
                  simType === t.id && t.available
                    ? "border-blue-500 bg-blue-500/10"
                    : t.available
                    ? "border-slate-700/80 bg-slate-800/40 hover:border-slate-500"
                    : "border-slate-800 bg-slate-900/30 opacity-45 cursor-not-allowed"
                }`}
              >
                <div className="flex items-start gap-4">
                  <span className="text-3xl leading-none mt-0.5">{t.emoji}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="font-semibold text-white">{t.title}</h3>
                      {!t.available && (
                        <span className="text-xs px-2 py-0.5 bg-slate-700 text-slate-400 rounded-full">Coming soon</span>
                      )}
                      {simType === t.id && t.available && (
                        <span className="text-xs px-2 py-0.5 bg-blue-600/80 text-white rounded-full">Selected</span>
                      )}
                    </div>
                    <p className="text-slate-400 text-sm mt-1 leading-relaxed">{t.desc}</p>
                  </div>
                </div>
              </button>
            ))}

            <div className="flex justify-end pt-4">
              <button
                onClick={() => setStep(1)}
                className="flex items-center gap-2 px-6 py-3 bg-blue-600 hover:bg-blue-500 text-white font-semibold rounded-xl transition-colors"
              >
                Continue <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        {/* ── Step 1: Upload + Preview ── */}
        {step === 1 && (
          <div>
            <div className="mb-5">
              <h2 className="text-xl font-bold text-white">Upload Your 3D Model</h2>
              <p className="text-slate-400 text-sm mt-1">
                {geometryId
                  ? "Inspect the geometry before continuing."
                  : "Supported formats: STL, OBJ, STEP. Maximum 100 MB."}
              </p>
            </div>

            {/* ── No geometry yet: full uploader ── */}
            {!geometryId && (
              <div className="bg-slate-800/30 border border-slate-700/60 rounded-2xl p-6">
                <GeometryUploader onUploaded={handleUploaded} />
              </div>
            )}

            {/* ── Geometry loaded: viewer + info ── */}
            {geometryId && (
              <div className="flex flex-col lg:flex-row gap-5">

                {/* 3D Viewer */}
                <div className="flex-1 min-w-0">
                  <div
                    className="w-full rounded-2xl overflow-hidden border border-slate-700/60"
                    style={{ height: "480px" }}
                  >
                    <Suspense fallback={
                      <div className="h-full flex items-center justify-center text-slate-400 text-sm bg-slate-950">
                        Loading 3D viewer…
                      </div>
                    }>
                      <GeometryViewer3D
                        geometryUrl={`${API_BASE}/upload/geometry/${geometryId}/file`}
                        filename={geometryName}
                        windAngleDeg={0}
                        windSpeed={20}
                        visualMode="geometry"
                        showWireframe={false}
                        showWindArrow={false}
                        onMeshInfo={setMeshInfo}
                      />
                    </Suspense>
                  </div>
                </div>

                {/* Right panel: info + controls */}
                <div className="lg:w-72 flex flex-col gap-4 shrink-0">

                  {/* Uploaded file */}
                  <div className="bg-slate-800/50 border border-green-500/30 rounded-2xl p-4">
                    <div className="flex items-center gap-3 mb-3">
                      <CheckCircle2 className="w-5 h-5 text-green-400 shrink-0" />
                      <span className="text-green-300 font-medium text-sm truncate">{geometryName}</span>
                    </div>
                    <button
                      onClick={handleReset}
                      className="w-full flex items-center justify-center gap-2 px-3 py-2 text-xs text-slate-400 hover:text-slate-200 border border-slate-700 hover:border-slate-500 rounded-lg transition-colors"
                    >
                      <RotateCcw className="w-3.5 h-3.5" /> Upload different file
                    </button>
                  </div>

                  {/* Geometry dimensions */}
                  {meshInfo && (
                    <div className="bg-slate-800/50 border border-slate-700/60 rounded-2xl p-4">
                      <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">
                        Geometry Info
                      </p>
                      <div className="space-y-2">
                        {[
                          ["Length (X)", `${meshInfo.dimX} m`],
                          ["Width (Y)",  `${meshInfo.dimY} m`],
                          ["Height (Z)", `${meshInfo.dimZ} m`],
                          ["Triangles",  meshInfo.faces.toLocaleString()],
                          ["Vertices",   meshInfo.vertices.toLocaleString()],
                        ].map(([label, value]) => (
                          <div key={label} className="flex justify-between items-baseline">
                            <span className="text-slate-500 text-xs">{label}</span>
                            <span className="text-slate-200 text-sm font-mono">{value}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Navigation hint */}
                  <div className="bg-slate-800/30 border border-slate-700/40 rounded-2xl p-4">
                    <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">
                      Controls
                    </p>
                    <div className="space-y-1 text-xs text-slate-500">
                      <p>Left drag — rotate</p>
                      <p>Scroll — zoom</p>
                      <p>Right drag — pan</p>
                    </div>
                  </div>

                </div>
              </div>
            )}

            {/* Navigation */}
            <div className="flex justify-between mt-6">
              <button
                onClick={() => setStep(0)}
                className="flex items-center gap-2 px-5 py-2.5 text-slate-400 hover:text-white border border-slate-700 hover:border-slate-500 rounded-xl transition-colors text-sm"
              >
                <ArrowLeft className="w-4 h-4" /> Back
              </button>
              <button
                onClick={() => setStep(2)}
                disabled={!geometryId}
                className={`flex items-center gap-2 px-6 py-3 font-semibold rounded-xl transition-colors text-sm ${
                  geometryId
                    ? "bg-blue-600 hover:bg-blue-500 text-white"
                    : "bg-slate-800 text-slate-600 cursor-not-allowed border border-slate-700"
                }`}
              >
                Continue <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        {/* ── Step 2: Configure ── */}
        {step === 2 && (
          <div>
            <div className="mb-5">
              <h2 className="text-xl font-bold text-white">Configure Simulation</h2>
              <p className="text-slate-400 text-sm mt-1">
                Set wind parameters for <span className="text-blue-300 font-medium">{geometryName}</span>.
              </p>
            </div>

            {error && (
              <div className="mb-4 p-4 bg-red-500/10 border border-red-500/30 rounded-xl text-red-400 text-sm">
                {error}
              </div>
            )}

            <div className="flex flex-col lg:flex-row gap-5">
              {/* 3D Viewer — live wind arrow */}
              {geometryId && (
                <div className="flex-1 min-w-0">
                  <div
                    className="w-full rounded-2xl overflow-hidden border border-slate-700/60"
                    style={{ height: "520px" }}
                  >
                    <Suspense fallback={
                      <div className="h-full flex items-center justify-center text-slate-400 text-sm bg-slate-950">
                        Loading 3D viewer…
                      </div>
                    }>
                      <GeometryViewer3D
                        geometryUrl={`${API_BASE}/upload/geometry/${geometryId}/file`}
                        filename={geometryName}
                        windAngleDeg={previewWind.angle}
                        windSpeed={previewWind.speed}
                        visualMode="geometry"
                        showWireframe={false}
                        showWindArrow={true}
                      />
                    </Suspense>
                  </div>
                  <p className="text-xs text-slate-600 mt-2 text-center">
                    Blue arrow shows wind direction — drag the sliders to adjust
                  </p>
                </div>
              )}

              {/* Config form */}
              <div className="lg:w-80 shrink-0">
                <div className="bg-slate-800/30 border border-slate-700/60 rounded-2xl p-5">
                  <SimulationConfig
                    geometryId={geometryId}
                    onSubmit={handleSubmit}
                    isLoading={submitting}
                    onWindChange={setPreviewWind}
                  />
                </div>
              </div>
            </div>

            <div className="flex justify-start mt-4">
              <button
                onClick={() => setStep(1)}
                className="flex items-center gap-2 px-5 py-2.5 text-slate-400 hover:text-white border border-slate-700 hover:border-slate-500 rounded-xl transition-colors text-sm"
              >
                <ArrowLeft className="w-4 h-4" /> Back
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
