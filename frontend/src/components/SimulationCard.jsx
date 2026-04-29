import React from "react";
import { Link } from "react-router-dom";
import {
  Clock, CheckCircle2, XCircle, Loader2, Trash2,
  ExternalLink, Wind, AlertCircle,
} from "lucide-react";

const STATUS_MAP = {
  queued:         { label: "Queued",      color: "bg-slate-600/40 text-slate-300",   dot: "bg-slate-400",  spin: false },
  preprocessing:  { label: "Setting up",  color: "bg-blue-500/20 text-blue-300",     dot: "bg-blue-400",   spin: true  },
  meshing:        { label: "Meshing",     color: "bg-violet-500/20 text-violet-300", dot: "bg-violet-400", spin: true  },
  running:        { label: "Solving",     color: "bg-amber-500/20 text-amber-300",   dot: "bg-amber-400",  spin: true  },
  postprocessing: { label: "Processing",  color: "bg-teal-500/20 text-teal-300",     dot: "bg-teal-400",   spin: true  },
  completed:      { label: "Completed",   color: "bg-green-500/20 text-green-300",   dot: "bg-green-400",  spin: false },
  failed:         { label: "Failed",      color: "bg-red-500/20 text-red-300",       dot: "bg-red-400",    spin: false },
};

export default function SimulationCard({ sim, onDelete }) {
  const s = STATUS_MAP[sim.status] || STATUS_MAP.queued;
  const isActive = !["completed", "failed"].includes(sim.status);
  const date = new Date(sim.createdAt).toLocaleDateString("en-GB", {
    day: "2-digit", month: "short", year: "numeric",
  });

  return (
    <div className="bg-slate-800/60 border border-slate-700/80 rounded-2xl overflow-hidden hover:border-slate-500 hover:shadow-xl hover:shadow-black/20 transition-all group flex flex-col">

      {/* Preview area */}
      <div className="h-36 bg-gradient-to-br from-slate-900 via-slate-850 to-slate-900 flex items-center justify-center relative overflow-hidden">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-blue-900/20 via-transparent to-transparent" />
        <Wind className="w-14 h-14 text-slate-700 group-hover:text-slate-600 transition-colors" />

        {/* Status badge */}
        <div className={`absolute top-3 right-3 flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${s.color} backdrop-blur-sm`}>
          {s.spin ? (
            <Loader2 className="w-2.5 h-2.5 animate-spin" />
          ) : (
            <span className={`w-2 h-2 rounded-full ${s.dot} ${s.spin ? "animate-pulse" : ""}`} />
          )}
          {s.label}
        </div>

        {/* Type badge */}
        <div className="absolute top-3 left-3 px-2 py-0.5 bg-slate-900/70 backdrop-blur-sm rounded text-xs text-slate-400 font-mono">
          Ext. Aero
        </div>
      </div>

      {/* Body */}
      <div className="p-4 flex flex-col flex-1">
        <h3 className="font-semibold text-white text-sm truncate mb-0.5">{sim.geometryName}</h3>
        <p className="text-slate-500 text-xs mb-3">{date}</p>

        {/* Quick stats (only for completed) */}
        {sim.status === "completed" && sim.results && (
          <div className="grid grid-cols-3 gap-2 mb-3">
            {[
              { label: "Cd", value: sim.results.Cd?.toFixed(3) },
              { label: "Cl", value: sim.results.Cl?.toFixed(3) },
              { label: "SPL", value: sim.results.noise_spl_db ? `${Math.round(sim.results.noise_spl_db)} dB` : null },
            ].map(({ label, value }) => (
              <div key={label} className="bg-slate-900/60 rounded-lg py-2 text-center">
                <p className="text-slate-500 text-xs">{label}</p>
                <p className="text-white font-bold font-mono text-xs mt-0.5">{value ?? "—"}</p>
              </div>
            ))}
          </div>
        )}

        {/* Wind info */}
        {sim.windSpeed && (
          <p className="text-xs text-slate-500 mb-3">
            {(sim.windSpeed * 3.6).toFixed(0)} km/h · {sim.windAngleDeg}° · {sim.meshQuality}
          </p>
        )}

        <div className="mt-auto flex gap-2">
          <Link
            to={`/results/${sim.jobId}`}
            className="flex-1 flex items-center justify-center gap-1.5 py-2 bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold rounded-lg transition-colors"
          >
            <ExternalLink className="w-3 h-3" />
            {isActive ? "View Progress" : "View Results"}
          </Link>
          <button
            onClick={(e) => { e.preventDefault(); onDelete(sim.jobId); }}
            className="p-2 text-slate-600 hover:text-red-400 hover:bg-red-400/10 rounded-lg transition-colors"
            title="Delete"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}
