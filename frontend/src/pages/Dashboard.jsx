import React, { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { Plus, Wind, CheckCircle2, Clock, BarChart3, Zap } from "lucide-react";
import SimulationCard from "../components/SimulationCard";
import { getSimulations, deleteSimulation } from "../services/storage";

export default function Dashboard() {
  const [simulations, setSimulations] = useState([]);

  useEffect(() => { setSimulations(getSimulations()); }, []);

  const handleDelete = (jobId) => {
    deleteSimulation(jobId);
    setSimulations(prev => prev.filter(s => s.jobId !== jobId));
  };

  const completed = simulations.filter(s => s.status === "completed");
  const running   = simulations.filter(s => !["completed", "failed"].includes(s.status));
  const avgCd     = completed.length
    ? (completed.reduce((acc, s) => acc + (s.results?.Cd ?? 0), 0) / completed.length).toFixed(3)
    : null;

  return (
    <div className="min-h-[calc(100vh-64px)] bg-slate-950">

      {/* Hero / banner */}
      <div className="bg-gradient-to-b from-slate-900 to-slate-950 border-b border-slate-800">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-6">
            <div>
              <h1 className="text-3xl font-extrabold text-white tracking-tight">My Simulations</h1>
              <p className="text-slate-400 mt-1 max-w-lg">
                Upload a 3D model, configure wind parameters, and get aerodynamic results powered by OpenFOAM.
              </p>
            </div>
            <Link
              to="/new"
              className="self-start sm:self-auto flex items-center gap-2 px-5 py-2.5 bg-blue-600 hover:bg-blue-500 text-white font-semibold rounded-xl transition-colors shadow-lg shadow-blue-900/30 whitespace-nowrap"
            >
              <Plus className="w-4 h-4" />
              New Simulation
            </Link>
          </div>

          {/* Stats bar */}
          {simulations.length > 0 && (
            <div className="flex flex-wrap gap-6 mt-8 pt-6 border-t border-slate-800">
              {[
                { icon: Wind,         label: "Total",     value: simulations.length, color: "text-blue-400" },
                { icon: CheckCircle2, label: "Completed", value: completed.length,   color: "text-green-400" },
                { icon: Clock,        label: "Running",   value: running.length,     color: "text-amber-400" },
                avgCd ? { icon: BarChart3, label: "Avg Cd", value: avgCd, color: "text-violet-400" } : null,
              ].filter(Boolean).map(({ icon: Icon, label, value, color }) => (
                <div key={label} className="flex items-center gap-2">
                  <Icon className={`w-4 h-4 ${color}`} />
                  <span className="text-slate-400 text-sm">{label}:</span>
                  <span className="text-white font-bold text-sm font-mono">{value}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Main content */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">

        {simulations.length === 0 ? (
          /* Empty state */
          <div className="text-center py-20">
            <div className="w-24 h-24 rounded-full bg-slate-800 border border-slate-700 flex items-center justify-center mx-auto mb-6">
              <Wind className="w-12 h-12 text-slate-600" />
            </div>
            <h2 className="text-2xl font-bold text-white mb-2">No simulations yet</h2>
            <p className="text-slate-400 mb-8 max-w-sm mx-auto">
              Upload a 3D geometry file and run your first CFD aerodynamic simulation.
            </p>
            <Link
              to="/new"
              className="inline-flex items-center gap-2 px-6 py-3 bg-blue-600 hover:bg-blue-500 text-white font-semibold rounded-xl transition-colors shadow-lg shadow-blue-900/30"
            >
              <Plus className="w-5 h-5" /> Start Your First Simulation
            </Link>

            {/* Feature grid */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-5 max-w-2xl mx-auto mt-16">
              {[
                { icon: "📦", title: "Upload STL / OBJ", desc: "Any 3D geometry file up to 100 MB" },
                { icon: "🌬️", title: "Configure Wind",   desc: "Speed, angle, turbulence model, mesh quality" },
                { icon: "📊", title: "Get Results",      desc: "Cd, Cl, pressure maps, streamlines, PDF report" },
              ].map(({ icon, title, desc }) => (
                <div key={title} className="bg-slate-800/50 border border-slate-700/60 rounded-2xl p-6 text-center">
                  <div className="text-4xl mb-3">{icon}</div>
                  <h3 className="text-white font-semibold text-sm mb-1">{title}</h3>
                  <p className="text-slate-400 text-xs leading-relaxed">{desc}</p>
                </div>
              ))}
            </div>
          </div>

        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">

            {/* "New simulation" tile */}
            <Link
              to="/new"
              className="border-2 border-dashed border-slate-700 rounded-2xl flex flex-col items-center justify-center gap-3 p-8 text-slate-500 hover:border-blue-500/70 hover:text-blue-400 hover:bg-blue-900/5 transition-all min-h-[280px] group"
            >
              <div className="w-14 h-14 rounded-2xl bg-slate-800 group-hover:bg-blue-900/30 flex items-center justify-center transition-colors border border-slate-700 group-hover:border-blue-700">
                <Plus className="w-7 h-7" />
              </div>
              <span className="text-sm font-medium">New Simulation</span>
            </Link>

            {simulations.map(sim => (
              <SimulationCard key={sim.jobId} sim={sim} onDelete={handleDelete} />
            ))}
          </div>
        )}
      </div>

      {/* Footer */}
      <footer className="mt-16 pb-8 text-center text-xs text-slate-700 border-t border-slate-900 pt-8">
        AkisCFD · OpenFOAM · Three.js · FastAPI · React
      </footer>
    </div>
  );
}
