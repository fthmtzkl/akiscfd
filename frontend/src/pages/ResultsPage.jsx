import React, { useState, useEffect, useCallback } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import JobStatus from "../components/JobStatus";
import ResultsViewer from "../components/ResultsViewer";
import { getSimulations, updateSimulation } from "../services/storage";

export default function ResultsPage() {
  const { jobId }    = useParams();
  const navigate     = useNavigate();
  const [results,    setResults]  = useState(null);
  const [simInfo,    setSimInfo]  = useState(null);

  useEffect(() => {
    const sim = getSimulations().find(s => s.jobId === jobId) ?? null;
    setSimInfo(sim);
  }, [jobId]);

  const handleComplete = useCallback((res) => {
    if (!res) return;
    const full = {
      ...res,
      request: simInfo ? {
        wind_speed:       simInfo.windSpeed,
        wind_angle_deg:   simInfo.windAngleDeg,
        turbulence_model: simInfo.turbulenceModel,
        mesh_quality:     simInfo.meshQuality,
        num_iterations:   simInfo.numIterations,
      } : res.request,
    };
    setResults(full);
    updateSimulation(jobId, {
      status: res.status ?? "completed",
      results: res.force_coefficients ? {
        Cd:          res.force_coefficients.Cd,
        Cl:          res.force_coefficients.Cl,
        noise_spl_db: res.noise_spl_db,
      } : null,
    });
  }, [jobId, simInfo]);

  return (
    <div className="min-h-[calc(100vh-64px)] bg-slate-950">

      {/* Breadcrumb bar */}
      <div className="bg-slate-900 border-b border-slate-800">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-3.5 flex items-center gap-3">
          <Link
            to="/"
            className="flex items-center gap-1.5 text-sm text-slate-400 hover:text-white transition-colors"
          >
            <ArrowLeft className="w-4 h-4" /> Dashboard
          </Link>
          <span className="text-slate-700">›</span>
          <span className="text-sm text-slate-300 font-medium truncate max-w-xs">
            {simInfo?.geometryName ?? jobId?.slice(0, 8) + "…"}
          </span>
          {simInfo && (
            <>
              <span className="text-slate-700">·</span>
              <span className="text-xs text-slate-500">
                {(simInfo.windSpeed * 3.6).toFixed(0)} km/h · {simInfo.windAngleDeg}°
              </span>
            </>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {!results ? (
          /* Running */
          <div className="max-w-xl mx-auto">
            <div className="bg-slate-800/60 border border-slate-700 rounded-2xl p-8">
              <h2 className="text-lg font-bold text-white mb-6">Simulation Progress</h2>
              <JobStatus jobId={jobId} onComplete={handleComplete} />
            </div>
          </div>
        ) : (
          /* Results */
          <ResultsViewer
            results={results}
            geometryId={simInfo?.geometryId}
            geometryFilename={simInfo?.geometryName}
          />
        )}
      </div>
    </div>
  );
}
