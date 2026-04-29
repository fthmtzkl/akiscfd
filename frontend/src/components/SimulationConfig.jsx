import React, { useState } from "react";
import { Car, RotateCcw, Layers, Play, Info } from "lucide-react";

const MS_TO_KMH = 3.6;

const TURBULENCE_MODELS = [
  { value: "kOmegaSST", label: "k-ω SST", description: "Best for external aero. Handles adverse pressure gradients well." },
  { value: "kEpsilon",  label: "k-ε",      description: "Fast and robust. Good for free-stream turbulence." },
];

const MESH_QUALITIES = [
  { value: "coarse", label: "Coarse", cells: "~500K cells",  time: "~10 min" },
  { value: "medium", label: "Medium", cells: "~2M cells",    time: "~30 min" },
  { value: "fine",   label: "Fine",   cells: "~8M cells",    time: "~90 min" },
];

const DEFAULT_CONFIG = {
  wind_speed: 20, wind_angle_deg: 0,
  turbulence_model: "kOmegaSST", mesh_quality: "medium", num_iterations: 500,
};

export default function SimulationConfig({ geometryId, onSubmit, isLoading, onWindChange }) {
  const [config, setConfig] = useState(DEFAULT_CONFIG);

  const set = (key, value) => {
    const next = { ...config, [key]: value };
    setConfig(next);
    if (key === "wind_angle_deg" || key === "wind_speed") {
      onWindChange?.({ angle: next.wind_angle_deg, speed: next.wind_speed });
    }
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!geometryId) return;
    onSubmit?.({ ...config, geometry_id: geometryId });
  };

  const canSubmit = !!geometryId && !isLoading;

  const label = "block text-sm font-medium text-slate-300 mb-2";
  const card  = (active) => [
    "text-left p-3.5 rounded-xl border-2 transition-all",
    active ? "border-blue-500 bg-blue-500/10" : "border-slate-700 bg-slate-800/40 hover:border-slate-500",
  ].join(" ");

  return (
    <form onSubmit={handleSubmit} className="space-y-7">

      {/* Vehicle Speed */}
      <div>
        <label className={label}>
          <span className="flex items-center gap-2">
            <Car className="w-4 h-4 text-slate-400" />
            Vehicle Speed
            <span className="ml-auto text-blue-400 font-bold font-mono">
              {(config.wind_speed * MS_TO_KMH).toFixed(0)} km/h
            </span>
            <span className="text-slate-500 text-xs">({config.wind_speed.toFixed(1)} m/s)</span>
          </span>
        </label>
        <input
          type="range" min={1} max={100} step={1}
          value={config.wind_speed}
          onChange={e => set("wind_speed", Number(e.target.value))}
          className="w-full h-1.5 bg-slate-700 rounded-full appearance-none cursor-pointer accent-blue-500"
        />
        <div className="flex justify-between text-xs text-slate-600 mt-1">
          <span>3.6 km/h</span><span>180 km/h</span><span>360 km/h</span>
        </div>
      </div>

      {/* Wind Direction */}
      <div>
        <label className={label}>
          <span className="flex items-center gap-2">
            <RotateCcw className="w-4 h-4 text-slate-400" />
            Wind Direction
            <span className="ml-auto text-blue-400 font-bold font-mono">{config.wind_angle_deg}°</span>
          </span>
        </label>
        <div className="flex items-center gap-4">
          {/* Compass */}
          <div className="relative w-20 h-20 flex-shrink-0">
            <svg viewBox="0 0 100 100" className="w-full h-full">
              <circle cx="50" cy="50" r="45" fill="#1e293b" stroke="#334155" strokeWidth="2" />
              {["N","E","S","W"].map((lbl, i) => {
                const a = (i * 90 - 90) * (Math.PI / 180);
                return (
                  <text key={lbl} x={50 + 33 * Math.cos(a)} y={50 + 33 * Math.sin(a)}
                    textAnchor="middle" dominantBaseline="middle"
                    fontSize="10" fill="#64748b" fontWeight="bold">{lbl}</text>
                );
              })}
              <g transform={`rotate(${config.wind_angle_deg} 50 50)`}>
                <line x1="50" y1="50" x2="50" y2="15" stroke="#3b82f6" strokeWidth="3" strokeLinecap="round" />
                <polygon points="50,10 45,20 55,20" fill="#3b82f6" />
              </g>
              <circle cx="50" cy="50" r="4" fill="#1d4ed8" />
            </svg>
          </div>
          <div className="flex-1 space-y-1">
            <input
              type="range" min={0} max={359} step={5}
              value={config.wind_angle_deg}
              onChange={e => set("wind_angle_deg", Number(e.target.value))}
              className="w-full h-1.5 bg-slate-700 rounded-full appearance-none cursor-pointer accent-blue-500"
            />
            <div className="flex justify-between text-xs text-slate-600">
              <span>0°</span><span>90°</span><span>180°</span><span>270°</span>
            </div>
          </div>
        </div>
      </div>

      {/* Turbulence Model */}
      <div>
        <label className={label}>
          <span className="flex items-center gap-2"><Layers className="w-4 h-4 text-slate-400" />Turbulence Model</span>
        </label>
        <div className="grid grid-cols-2 gap-2">
          {TURBULENCE_MODELS.map(m => (
            <button key={m.value} type="button" onClick={() => set("turbulence_model", m.value)}
              className={card(config.turbulence_model === m.value)}>
              <p className="font-mono font-semibold text-sm text-white">{m.label}</p>
              <p className="text-xs text-slate-400 mt-0.5">{m.description}</p>
            </button>
          ))}
        </div>
      </div>

      {/* Mesh Quality */}
      <div>
        <label className={label}>Mesh Quality</label>
        <div className="grid grid-cols-3 gap-2">
          {MESH_QUALITIES.map(q => (
            <button key={q.value} type="button" onClick={() => set("mesh_quality", q.value)}
              className={card(config.mesh_quality === q.value) + " text-center"}>
              <p className="font-semibold text-sm text-white">{q.label}</p>
              <p className="text-xs text-slate-500 mt-0.5">{q.cells}</p>
              <p className="text-xs text-slate-600">{q.time}</p>
            </button>
          ))}
        </div>
      </div>

      {/* Iterations */}
      <div>
        <label className={label}>
          <span className="flex items-center gap-2">
            Iterations
            <span className="ml-auto text-blue-400 font-bold font-mono">{config.num_iterations}</span>
          </span>
        </label>
        <input
          type="range" min={50} max={2000} step={50}
          value={config.num_iterations}
          onChange={e => set("num_iterations", Number(e.target.value))}
          className="w-full h-1.5 bg-slate-700 rounded-full appearance-none cursor-pointer accent-blue-500"
        />
        <div className="flex justify-between text-xs text-slate-600 mt-1">
          <span>50 (quick)</span><span>500 (rec.)</span><span>2000 (thorough)</span>
        </div>
      </div>

      {/* Warning */}
      {!geometryId && (
        <div className="flex items-center gap-2 p-3.5 bg-amber-500/10 border border-amber-500/30 rounded-xl text-amber-300 text-sm">
          <Info className="w-4 h-4 flex-shrink-0" />
          Upload a geometry file first to enable simulation.
        </div>
      )}

      {/* Submit */}
      <button
        type="submit"
        disabled={!canSubmit}
        className={[
          "w-full flex items-center justify-center gap-2 py-3.5 px-6 rounded-xl font-bold text-white transition-all",
          canSubmit
            ? "bg-blue-600 hover:bg-blue-500 shadow-lg shadow-blue-900/30 active:scale-[0.98]"
            : "bg-slate-800 border border-slate-700 text-slate-600 cursor-not-allowed",
        ].join(" ")}
      >
        {isLoading ? (
          <>
            <svg className="animate-spin w-5 h-5" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
            </svg>
            Simulation Running…
          </>
        ) : (
          <><Play className="w-5 h-5" />Run Simulation</>
        )}
      </button>
    </form>
  );
}
