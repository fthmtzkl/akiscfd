import React, { useEffect, useRef, useState, Suspense, lazy } from "react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from "recharts";
import {
  Wind, ArrowDown, ArrowRight, Thermometer, Gauge, Volume2,
  Layers, FileText, Grid3x3, Eye, Waves,
} from "lucide-react";
import { getVtkFileUrl } from "../services/api";

const GeometryViewer3D = lazy(() => import("./GeometryViewer3D"));
const Viewer3D          = lazy(() => import("./Viewer3D"));
const ReportModal       = lazy(() => import("./ReportModal"));

const MS_TO_KMH = 3.6;

const MODES = [
  { key: "pressure",    label: "Pressure",    icon: <Thermometer className="w-3.5 h-3.5" /> },
  { key: "friction",    label: "Friction",    icon: <Layers       className="w-3.5 h-3.5" /> },
  { key: "drag",        label: "Drag",        icon: <ArrowRight   className="w-3.5 h-3.5" /> },
  { key: "noise",       label: "Noise",       icon: <Volume2      className="w-3.5 h-3.5" /> },
  { key: "streamlines", label: "Streamlines", icon: <Waves        className="w-3.5 h-3.5" /> },
  { key: "geometry",    label: "Geometry",    icon: <Eye          className="w-3.5 h-3.5" /> },
];

// ── Coefficient card ──────────────────────────────────────────────────────────

function CoeffCard({ label, value, unit = "", icon, accent = "blue", description }) {
  const accents = {
    blue:   "border-blue-500/30 bg-blue-500/10 text-blue-300",
    green:  "border-green-500/30 bg-green-500/10 text-green-300",
    violet: "border-violet-500/30 bg-violet-500/10 text-violet-300",
    amber:  "border-amber-500/30 bg-amber-500/10 text-amber-300",
    rose:   "border-rose-500/30 bg-rose-500/10 text-rose-300",
  };
  return (
    <div className={`flex flex-col gap-1.5 p-4 rounded-xl border ${accents[accent]}`}>
      <div className="flex items-center gap-1.5 text-xs font-medium opacity-80">
        {icon}{label}
      </div>
      <div className="text-2xl font-extrabold font-mono text-white">
        {value !== null && value !== undefined
          ? (typeof value === "number" ? value.toFixed(3) : value)
          : "—"}
        {unit && <span className="text-sm font-normal ml-1 opacity-50">{unit}</span>}
      </div>
      {description && <p className="text-xs opacity-50 leading-tight">{description}</p>}
    </div>
  );
}

// ── Mesh info panel ───────────────────────────────────────────────────────────

function MeshInfoPanel({ meshInfo }) {
  if (!meshInfo) return null;
  return (
    <div className="mt-3 p-4 bg-slate-900 rounded-xl border border-slate-700">
      <p className="text-xs font-semibold text-slate-300 mb-3 flex items-center gap-1.5">
        <Grid3x3 className="w-3.5 h-3.5" /> Mesh Details
      </p>
      <div className="grid grid-cols-3 gap-x-4 gap-y-2 text-xs">
        {[
          ["Vertices", meshInfo.vertices?.toLocaleString()],
          ["Faces",    meshInfo.faces?.toLocaleString()],
          ["Dim X",    `${meshInfo.dimX} m`],
          ["Dim Y",    `${meshInfo.dimY} m`],
          ["Dim Z",    `${meshInfo.dimZ} m`],
          ["Est. Area",`${meshInfo.area} m²`],
        ].map(([k, v]) => (
          <div key={k} className="flex flex-col gap-0.5">
            <span className="text-slate-500">{k}</span>
            <span className="text-slate-200 font-mono font-semibold">{v ?? "–"}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Residual chart ────────────────────────────────────────────────────────────

function ResidualChart({ residuals }) {
  if (!residuals?.length) return (
    <div className="h-52 flex items-center justify-center text-slate-500 text-sm">
      No residual data.
    </div>
  );

  const fields = Object.keys(residuals[0]).filter(k => k !== "iteration");
  const COLORS = { Ux:"#3b82f6", Uy:"#8b5cf6", Uz:"#06b6d4", p:"#ef4444", k:"#10b981", omega:"#f59e0b", epsilon:"#f97316" };

  return (
    <ResponsiveContainer width="100%" height={260}>
      <LineChart data={residuals} margin={{ top:8, right:16, bottom:8, left:0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
        <XAxis dataKey="iteration" tick={{ fontSize:10, fill:"#64748b" }}
          label={{ value:"Iteration", position:"insideBottom", offset:-4, fontSize:10, fill:"#64748b" }} />
        <YAxis scale="log" domain={["auto","auto"]} tickFormatter={v=>v.toExponential(0)}
          tick={{ fontSize:9, fill:"#64748b" }}
          label={{ value:"Residual", angle:-90, position:"insideLeft", fontSize:10, fill:"#64748b" }} />
        <Tooltip
          formatter={(v,n)=>[v.toExponential(3),n]}
          contentStyle={{ fontSize:11, borderRadius:8, background:"#1e293b", border:"1px solid #334155", color:"#e2e8f0" }}
        />
        <Legend iconSize={9} wrapperStyle={{ fontSize:10, color:"#94a3b8" }} />
        {fields.map(f => (
          <Line key={f} type="monotone" dataKey={f} stroke={COLORS[f] ?? "#64748b"}
            dot={false} strokeWidth={1.5} isAnimationActive={false} />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function ResultsViewer({ results, geometryId, geometryFilename }) {
  const [activeTab,     setActiveTab]     = useState("summary");
  const [visualMode,    setVisualMode]    = useState("pressure");
  const [showWireframe, setShowWireframe] = useState(false);
  const [showMeshInfo,  setShowMeshInfo]  = useState(false);
  const [meshInfo,      setMeshInfo]      = useState(null);
  const [showReport,    setShowReport]    = useState(false);
  const captureRef = useRef(null);

  if (!results) return null;

  const { force_coefficients: fc, residuals, vtk_surface_url, vtk_volume_url,
          streamlines_url, pressure_min_pa, pressure_max_pa, velocity_max_ms,
          noise_spl_db, surface_area_m2, reynolds_number } = results;

  const surfaceUrl   = getVtkFileUrl(vtk_surface_url);
  const has3D        = !!geometryId || !!surfaceUrl;
  const windAngle    = results.request?.wind_angle_deg ?? 0;
  const windSpeed    = results.request?.wind_speed ?? 20;
  const vehicleSpeed = windSpeed * MS_TO_KMH;

  const tabs = [
    { key:"summary",   label:"Summary" },
    { key:"residuals", label:"Convergence" },
    { key:"3d",        label:"3D View", disabled:!has3D },
  ];

  const tabBtn = (tab) => [
    "px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors",
    activeTab === tab.key
      ? "border-blue-500 text-blue-400"
      : tab.disabled
      ? "border-transparent text-slate-700 cursor-not-allowed"
      : "border-transparent text-slate-400 hover:text-slate-200 hover:border-slate-600",
  ].join(" ");

  return (
    <div className="space-y-5">

      {/* Tab bar */}
      <div className="flex border-b border-slate-700/80 bg-slate-900/50 rounded-t-xl px-2 pt-2">
        {tabs.map(tab => (
          <button key={tab.key} onClick={() => !tab.disabled && setActiveTab(tab.key)}
            disabled={tab.disabled} className={tabBtn(tab)}>
            {tab.label}
          </button>
        ))}
        <button
          onClick={() => setShowReport(true)}
          className="ml-auto mb-1.5 flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-700 hover:bg-slate-600 text-slate-200 text-xs font-medium transition-colors"
        >
          <FileText className="w-3.5 h-3.5" /> Export PDF
        </button>
      </div>

      {/* ── Summary ── */}
      {activeTab === "summary" && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <CoeffCard label="Drag Cd"     value={fc?.Cd}  icon={<ArrowRight className="w-3 h-3"/>} accent="blue"   description="Lower = better aero" />
            <CoeffCard label="Lift Cl"     value={fc?.Cl}  icon={<Wind       className="w-3 h-3"/>} accent="green"  description="−ve = downforce" />
            <CoeffCard label="Side Cs"     value={fc?.Cs}  icon={<ArrowDown  className="w-3 h-3"/>} accent="violet" description="Lateral force" />
            <CoeffCard label="Friction Cf" value={fc?.Cf?.toFixed(5)} icon={<Layers className="w-3 h-3"/>} accent="amber" description="Skin friction" />
            <CoeffCard label="Drag Force"  value={fc?.drag_force_n != null ? fc.drag_force_n.toFixed(0) : undefined} unit="N" icon={<ArrowRight className="w-3 h-3"/>} accent="blue" />
            <CoeffCard label="Lift Force"  value={fc?.lift_force_n != null ? fc.lift_force_n.toFixed(0) : undefined} unit="N" icon={<Wind       className="w-3 h-3"/>} accent="green" />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <CoeffCard label="Min Pressure" value={pressure_min_pa?.toFixed(1)} unit="Pa"    icon={<Thermometer className="w-3 h-3"/>} accent="blue"   />
            <CoeffCard label="Max Velocity" value={velocity_max_ms?.toFixed(1)} unit="m/s"   icon={<Gauge       className="w-3 h-3"/>} accent="amber"  />
            <CoeffCard label="Noise (SPL)"  value={noise_spl_db?.toFixed(1)}    unit="dB(A)" icon={<Volume2     className="w-3 h-3"/>} accent="rose"   description="A-weighted estimate" />
            <CoeffCard label="Surface Area" value={surface_area_m2?.toFixed(2)} unit="m²"    icon={<Layers      className="w-3 h-3"/>} accent="violet" />
          </div>

          <div className="p-4 bg-slate-800/60 border border-slate-700/60 rounded-xl text-xs text-slate-400 space-y-1">
            <p>Vehicle speed: <b className="text-slate-200">{vehicleSpeed.toFixed(0)} km/h</b> ({windSpeed.toFixed(1)} m/s) · Wind angle: <b className="text-slate-200">{windAngle}°</b></p>
            {reynolds_number && <p>Reynolds number: <b className="text-slate-200 font-mono">{new Intl.NumberFormat("en-US").format(reynolds_number)}</b></p>}
            {fc?.frontal_area_m2 && <p>Reference frontal area: <b className="text-slate-200">{fc.frontal_area_m2} m²</b></p>}
          </div>
        </div>
      )}

      {/* ── Convergence ── */}
      {activeTab === "residuals" && (
        <div className="bg-slate-900/40 border border-slate-700/60 rounded-xl p-4">
          <p className="text-sm text-slate-400 mb-3">
            Initial residuals per iteration (log scale). Converged when all &lt; 10⁻⁴.
          </p>
          <ResidualChart residuals={residuals} />
        </div>
      )}

      {/* ── 3D View ── */}
      {activeTab === "3d" && (
        <div className="space-y-3">
          {/* Mode toolbar */}
          <div className="flex flex-wrap gap-1.5 items-center p-3 bg-slate-900/60 border border-slate-700/60 rounded-xl">
            {MODES.map(m => (
              <button key={m.key} onClick={() => setVisualMode(m.key)}
                className={[
                  "flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium border transition-colors",
                  visualMode === m.key
                    ? "bg-blue-600 border-blue-600 text-white"
                    : "bg-slate-800 border-slate-700 text-slate-400 hover:border-blue-500/50 hover:text-blue-400",
                ].join(" ")}
              >
                {m.icon} {m.label}
              </button>
            ))}

            <button onClick={() => setShowWireframe(w => !w)}
              className={[
                "flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium border transition-colors ml-auto",
                showWireframe ? "bg-emerald-600 border-emerald-600 text-white" : "bg-slate-800 border-slate-700 text-slate-400 hover:border-emerald-500/50",
              ].join(" ")}
            >
              <Grid3x3 className="w-3.5 h-3.5" /> Wireframe
            </button>

            <button onClick={() => setShowMeshInfo(v => !v)}
              className={[
                "flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium border transition-colors",
                showMeshInfo ? "bg-slate-600 border-slate-500 text-white" : "bg-slate-800 border-slate-700 text-slate-400 hover:border-slate-500",
              ].join(" ")}
            >
              <Layers className="w-3.5 h-3.5" /> Mesh Info
            </button>
          </div>

          {/* 3D canvas */}
          <div className="h-[520px] rounded-xl overflow-hidden border border-slate-700">
            <Suspense fallback={
              <div className="h-full flex items-center justify-center text-slate-400 text-sm bg-slate-950">
                Loading 3D viewer…
              </div>
            }>
              {surfaceUrl ? (
                <Viewer3D surfaceUrl={surfaceUrl} volumeUrl={getVtkFileUrl(vtk_volume_url)} streamlineUrl={getVtkFileUrl(streamlines_url)} />
              ) : geometryId ? (
                <GeometryViewer3D
                  geometryUrl={`/api/upload/geometry/${geometryId}/file`}
                  filename={geometryFilename ?? "model.stl"}
                  windAngleDeg={windAngle}
                  windSpeed={windSpeed}
                  visualMode={visualMode}
                  showWireframe={showWireframe}
                  showWindArrow={true}
                  captureRef={captureRef}
                  onMeshInfo={setMeshInfo}
                />
              ) : (
                <div className="h-full flex items-center justify-center text-slate-500 text-sm bg-slate-950">
                  No 3D data available.
                </div>
              )}
            </Suspense>
          </div>

          {showMeshInfo && <MeshInfoPanel meshInfo={meshInfo} />}
        </div>
      )}

      {/* Report modal */}
      {showReport && (
        <Suspense fallback={null}>
          <ReportModal
            results={results}
            geometryName={geometryFilename}
            captureRef={captureRef}
            onClose={() => setShowReport(false)}
          />
        </Suspense>
      )}
    </div>
  );
}
