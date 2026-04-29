import React, { useEffect, useState, useRef } from "react";
import { CheckCircle2, XCircle, Loader2, Cpu, Grid3x3, FlaskConical, BarChart3 } from "lucide-react";
import { streamJobProgress, getJobStatus } from "../services/api";

const STEP_ICONS = {
  preprocessing:  <Cpu          className="w-4 h-4" />,
  meshing:        <Grid3x3      className="w-4 h-4" />,
  running:        <FlaskConical className="w-4 h-4" />,
  postprocessing: <BarChart3    className="w-4 h-4" />,
  completed:      <CheckCircle2 className="w-4 h-4 text-green-400" />,
  failed:         <XCircle      className="w-4 h-4 text-red-400" />,
};

const STATUS_BADGE = {
  pending:        "bg-slate-700 text-slate-300",
  preprocessing:  "bg-blue-500/20 text-blue-300",
  meshing:        "bg-violet-500/20 text-violet-300",
  running:        "bg-amber-500/20 text-amber-300",
  postprocessing: "bg-teal-500/20 text-teal-300",
  completed:      "bg-green-500/20 text-green-300",
  failed:         "bg-red-500/20 text-red-300",
};

const PIPELINE_STEPS = [
  { key: "preprocessing",  label: "Pre-process" },
  { key: "meshing",        label: "Meshing" },
  { key: "running",        label: "CFD Solver" },
  { key: "postprocessing", label: "Post-process" },
  { key: "completed",      label: "Done" },
];
const STEP_ORDER = PIPELINE_STEPS.map(s => s.key);

export default function JobStatus({ jobId, onComplete }) {
  const [state, setState] = useState({
    status: "pending", progress_percent: 0, current_step: "Queued", error_message: null,
  });
  const esRef = useRef(null);

  useEffect(() => {
    if (!jobId) return;
    getJobStatus(jobId).then(setState).catch(() => {});
    esRef.current = streamJobProgress(jobId, {
      onMessage: (p) => setState(prev => ({ ...prev, ...p })),
      onDone:    (p) => {
        setState(prev => ({ ...prev, ...p }));
        if (p.status === "completed") {
          if (p.results) {
            onComplete?.(p.results);
          } else {
            import("../services/api").then(({ getResults }) =>
              getResults(jobId).then(onComplete).catch(() => onComplete?.(null))
            );
          }
        } else if (p.status === "failed") {
          onComplete?.(null);
        }
      },
      onError: () => {},
    });
    return () => esRef.current?.close();
  }, [jobId]);

  const { status, progress_percent, current_step, error_message } = state;
  const currentStepIndex = STEP_ORDER.indexOf(status);

  return (
    <div className="space-y-5">

      {/* Status badge + job ID */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <span className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium ${STATUS_BADGE[status] ?? STATUS_BADGE.pending}`}>
          {STEP_ICONS[status] ?? <Loader2 className="w-4 h-4 animate-spin" />}
          {status.charAt(0).toUpperCase() + status.slice(1)}
        </span>
        <span className="text-slate-600 text-xs font-mono">
          {jobId?.slice(0, 8)}…
        </span>
      </div>

      {/* Progress bar */}
      <div>
        <div className="flex justify-between text-xs text-slate-400 mb-2">
          <span>{current_step}</span>
          <span className="font-mono">{progress_percent}%</span>
        </div>
        <div className="w-full bg-slate-800 rounded-full h-2 overflow-hidden">
          <div
            className={`h-2 rounded-full transition-all duration-700 ${
              status === "failed"    ? "bg-red-500" :
              status === "completed" ? "bg-green-500" :
              "bg-blue-500"
            }`}
            style={{ width: `${progress_percent}%` }}
          />
        </div>
      </div>

      {/* Pipeline steps */}
      <div className="flex items-start">
        {PIPELINE_STEPS.map((step, i) => {
          const done    = currentStepIndex > i;
          const active  = currentStepIndex === i;
          const isError = status === "failed" && active;

          return (
            <React.Fragment key={step.key}>
              <div className="flex flex-col items-center gap-1.5 flex-1">
                <div className={[
                  "w-7 h-7 rounded-full flex items-center justify-center border-2 text-xs font-bold transition-all",
                  isError ? "border-red-500 bg-red-500/20 text-red-400" :
                  done    ? "border-green-500 bg-green-500/20 text-green-400" :
                  active  ? "border-blue-500 bg-blue-500/20 text-blue-400 animate-pulse" :
                  "border-slate-700 bg-slate-800 text-slate-600",
                ].join(" ")}>
                  {done ? "✓" : i + 1}
                </div>
                <span className={[
                  "text-xs text-center leading-tight",
                  active  ? "text-blue-400 font-medium" :
                  done    ? "text-green-400" :
                  "text-slate-600",
                ].join(" ")}>
                  {step.label}
                </span>
              </div>
              {i < PIPELINE_STEPS.length - 1 && (
                <div className={`h-px flex-1 -mt-3.5 mx-1 ${done ? "bg-green-500" : "bg-slate-800"}`} />
              )}
            </React.Fragment>
          );
        })}
      </div>

      {/* Error message */}
      {error_message && (
        <div className="p-4 bg-red-500/10 border border-red-500/30 rounded-xl">
          <p className="text-red-400 text-sm font-semibold mb-1">Simulation failed</p>
          <p className="text-red-300/70 text-xs font-mono break-all">{error_message}</p>
        </div>
      )}
    </div>
  );
}
