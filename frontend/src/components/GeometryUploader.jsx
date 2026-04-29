import React, { useState, useCallback } from "react";
import { useDropzone } from "react-dropzone";
import { Upload, CheckCircle2, XCircle, Loader2 } from "lucide-react";
import { uploadGeometry } from "../services/api";

const ACCEPTED = {
  "model/stl":                [".stl"],
  "application/octet-stream": [".stl", ".obj"],
  "model/obj":                [".obj"],
  "application/step":         [".step", ".stp"],
};

export default function GeometryUploader({ onUploaded }) {
  const [status,   setStatus]   = useState("idle");
  const [progress, setProgress] = useState(0);
  const [filename, setFilename] = useState("");
  const [errorMsg, setErrorMsg] = useState("");

  const onDrop = useCallback(async (accepted, rejected) => {
    if (rejected.length > 0) {
      setErrorMsg(rejected[0].errors[0]?.message ?? "Unsupported file");
      setStatus("error");
      return;
    }
    if (!accepted.length) return;

    const file = accepted[0];
    setFilename(file.name);
    setStatus("uploading");
    setProgress(0);
    setErrorMsg("");

    try {
      const result = await uploadGeometry(file, pct => setProgress(pct));
      setStatus("done");
      onUploaded?.(result.geometry_id, file.name);
    } catch (err) {
      setErrorMsg(err.message);
      setStatus("error");
    }
  }, [onUploaded]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept:   ACCEPTED,
    maxFiles: 1,
    maxSize:  100 * 1024 * 1024,
    disabled: status === "uploading",
  });

  const reset = () => { setStatus("idle"); setProgress(0); setFilename(""); setErrorMsg(""); };

  if (status === "done") return (
    <div className="flex flex-col items-center gap-3 p-8 border-2 border-green-500/50 rounded-2xl bg-green-500/5 text-center">
      <CheckCircle2 className="w-12 h-12 text-green-400" />
      <p className="text-green-300 font-semibold">{filename}</p>
      <p className="text-green-400/70 text-sm">Uploaded successfully</p>
      <button onClick={reset} className="text-sm text-slate-400 hover:text-slate-200 underline mt-1 transition-colors">
        Upload a different file
      </button>
    </div>
  );

  if (status === "error") return (
    <div className="flex flex-col items-center gap-3 p-8 border-2 border-red-500/50 rounded-2xl bg-red-500/5 text-center">
      <XCircle className="w-12 h-12 text-red-400" />
      <p className="text-red-300 font-semibold">Upload failed</p>
      <p className="text-red-400/80 text-sm">{errorMsg}</p>
      <button onClick={reset} className="text-sm text-slate-400 hover:text-slate-200 underline mt-1 transition-colors">
        Try again
      </button>
    </div>
  );

  return (
    <div
      {...getRootProps()}
      className={[
        "flex flex-col items-center gap-4 p-10 border-2 border-dashed rounded-2xl cursor-pointer transition-all select-none",
        isDragActive
          ? "border-blue-500 bg-blue-500/10"
          : "border-slate-600 bg-slate-900/40 hover:border-blue-500/60 hover:bg-blue-900/10",
        status === "uploading" ? "pointer-events-none opacity-60" : "",
      ].join(" ")}
    >
      <input {...getInputProps()} />

      {status === "uploading" ? (
        <>
          <Loader2 className="w-12 h-12 text-blue-400 animate-spin" />
          <p className="text-blue-300 font-medium">Uploading {filename}…</p>
          <div className="w-full max-w-xs bg-slate-800 rounded-full h-1.5">
            <div className="bg-blue-500 h-1.5 rounded-full transition-all" style={{ width: `${progress}%` }} />
          </div>
          <p className="text-blue-400/70 text-sm font-mono">{progress}%</p>
        </>
      ) : (
        <>
          <div className="w-16 h-16 rounded-2xl bg-slate-800 border border-slate-700 flex items-center justify-center">
            <Upload className="w-7 h-7 text-slate-400" />
          </div>
          <div className="text-center">
            <p className="text-slate-200 font-medium">
              {isDragActive ? "Drop your geometry file here" : "Drag & drop your 3D model"}
            </p>
            <p className="text-slate-500 text-sm mt-1">or click to browse files</p>
          </div>
          <div className="flex gap-2 flex-wrap justify-center">
            {[".stl", ".obj", ".step"].map(ext => (
              <span key={ext} className="px-2.5 py-1 bg-slate-800 border border-slate-700 rounded-lg text-xs text-slate-400 font-mono">
                {ext}
              </span>
            ))}
          </div>
          <p className="text-slate-600 text-xs">Maximum 100 MB</p>
        </>
      )}
    </div>
  );
}
