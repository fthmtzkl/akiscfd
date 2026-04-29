/**
 * ReportModal – generates and downloads a PDF report using jsPDF.
 * Props:
 *   results       {SimulationResults}
 *   geometryName  {string}
 *   captureRef    {object}  ref.current() → canvas dataURL
 *   onClose       {function}
 */
import React, { useState } from "react";
import { jsPDF } from "jspdf";
import { X, Download, FileText } from "lucide-react";

const MS_TO_KMH = 3.6;

export default function ReportModal({ results, geometryName, captureRef, onClose }) {
  const [generating, setGenerating] = useState(false);

  const fc  = results?.force_coefficients;
  const req = results?.request ?? {};
  const vehicleSpeed = (req.wind_speed ?? 0) * MS_TO_KMH;

  async function handleDownload() {
    setGenerating(true);
    try {
      const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
      const W = doc.internal.pageSize.getWidth();
      const margin = 15;
      const col = W - margin * 2;
      let y = margin;

      // ── Header ────────────────────────────────────────────────────────────
      doc.setFillColor(15, 23, 42);           // dark navy
      doc.rect(0, 0, W, 28, "F");
      doc.setTextColor(255, 255, 255);
      doc.setFontSize(16);
      doc.setFont("helvetica", "bold");
      doc.text("AkisCFD — Aerodynamic Analysis Report", margin, 12);
      doc.setFontSize(8);
      doc.setFont("helvetica", "normal");
      doc.text(`Generated: ${new Date().toLocaleString()}`, margin, 19);
      doc.text(`Geometry: ${geometryName ?? "–"}`, margin, 24);
      y = 36;

      // ── Simulation Parameters ────────────────────────────────────────────
      doc.setTextColor(30, 30, 30);
      sectionTitle(doc, "Simulation Parameters", y); y += 7;

      const params = [
        ["Vehicle Speed",     `${vehicleSpeed.toFixed(0)} km/h  (${(req.wind_speed ?? 0).toFixed(1)} m/s)`],
        ["Wind Angle",        `${req.wind_angle_deg ?? 0}°`],
        ["Turbulence Model",  req.turbulence_model ?? "–"],
        ["Mesh Quality",      req.mesh_quality ?? "–"],
        ["Solver Iterations", `${req.num_iterations ?? "–"}`],
        ["Reynolds Number",   results?.reynolds_number ? formatNum(results.reynolds_number) : "–"],
      ];
      y = dataTable(doc, params, margin, y, col); y += 5;

      // ── Force Coefficients ───────────────────────────────────────────────
      sectionTitle(doc, "Aerodynamic Coefficients", y); y += 7;
      const coeffs = [
        ["Drag Coefficient (Cd)",         fc?.Cd?.toFixed(4) ?? "–"],
        ["Lift Coefficient (Cl)",         fc?.Cl?.toFixed(4) ?? "–"],
        ["Side Force Coefficient (Cs)",   fc?.Cs?.toFixed(4) ?? "–"],
        ["Skin Friction Coefficient (Cf)",fc?.Cf?.toFixed(5) ?? "–"],
        ["Drag Force",                    fc?.drag_force_n != null ? `${fc.drag_force_n.toFixed(1)} N` : "–"],
        ["Lift Force",                    fc?.lift_force_n != null ? `${fc.lift_force_n.toFixed(1)} N` : "–"],
        ["Frontal Area",                  fc?.frontal_area_m2 != null ? `${fc.frontal_area_m2} m²` : "–"],
      ];
      y = dataTable(doc, coeffs, margin, y, col); y += 5;

      // ── Surface Statistics ───────────────────────────────────────────────
      sectionTitle(doc, "Flow & Surface Statistics", y); y += 7;
      const surface = [
        ["Min Surface Pressure", results?.pressure_min_pa != null ? `${results.pressure_min_pa.toFixed(1)} Pa` : "–"],
        ["Max Surface Pressure", results?.pressure_max_pa != null ? `${results.pressure_max_pa.toFixed(1)} Pa` : "–"],
        ["Max Velocity",         results?.velocity_max_ms != null ? `${results.velocity_max_ms.toFixed(1)} m/s` : "–"],
        ["Noise Level (SPL)",    results?.noise_spl_db    != null ? `${results.noise_spl_db.toFixed(1)} dB(A)` : "–"],
        ["Surface Area",         results?.surface_area_m2 != null ? `${results.surface_area_m2.toFixed(2)} m²` : "–"],
      ];
      y = dataTable(doc, surface, margin, y, col); y += 5;

      // ── 3D Screenshot ────────────────────────────────────────────────────
      if (captureRef?.current) {
        const imgData = captureRef.current();
        if (imgData) {
          sectionTitle(doc, "3D Visualisation", y); y += 5;
          const imgH = col * 0.56;
          if (y + imgH > doc.internal.pageSize.getHeight() - 20) {
            doc.addPage(); y = margin;
          }
          doc.addImage(imgData, "PNG", margin, y, col, imgH);
          y += imgH + 5;
        }
      }

      // ── Residuals table (condensed) ──────────────────────────────────────
      if (results?.residuals?.length) {
        if (y > doc.internal.pageSize.getHeight() - 60) { doc.addPage(); y = margin; }
        sectionTitle(doc, "Solver Convergence (final 3 iterations)", y); y += 7;
        const last3 = results.residuals.slice(-3);
        const residRows = last3.map(r => [
          `${r.iteration}`,
          r.Ux?.toExponential(2) ?? "–",
          r.p?.toExponential(2)  ?? "–",
          r.k?.toExponential(2)  ?? "–",
        ]);
        y = dataTable(doc, residRows, margin, y, col, ["Iteration","Ux","p","k"]); y += 5;
      }

      // ── Footer ───────────────────────────────────────────────────────────
      const pageCount = doc.internal.getNumberOfPages();
      for (let p = 1; p <= pageCount; p++) {
        doc.setPage(p);
        doc.setFontSize(7);
        doc.setTextColor(150, 150, 150);
        doc.text(
          `AkisCFD · Open-source aerodynamics · Page ${p}/${pageCount}`,
          margin, doc.internal.pageSize.getHeight() - 8
        );
      }

      const safeName = (geometryName ?? "report").replace(/\.[^.]+$/, "").replace(/\s+/g, "_");
      doc.save(`AkisCFD_Report_${safeName}_${Date.now()}.pdf`);
    } finally {
      setGenerating(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg mx-4 overflow-hidden">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 bg-slate-900 text-white">
          <div className="flex items-center gap-2">
            <FileText className="w-5 h-5 text-blue-400" />
            <h2 className="font-semibold">Generate Report</h2>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-white">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Preview */}
        <div className="px-6 py-5 space-y-4">
          <p className="text-sm text-gray-600">
            A PDF report will be generated with the following sections:
          </p>

          <ul className="space-y-2">
            {[
              "Simulation parameters",
              "Aerodynamic coefficients (Cd, Cl, Cs, Cf)",
              "Drag & Lift forces (N)",
              "Surface pressure & noise statistics",
              "3D visualisation screenshot",
              "Solver convergence data",
            ].map(item => (
              <li key={item} className="flex items-center gap-2 text-sm text-gray-700">
                <span className="w-1.5 h-1.5 rounded-full bg-blue-500 flex-shrink-0" />
                {item}
              </li>
            ))}
          </ul>

          {/* Quick stats preview */}
          <div className="grid grid-cols-3 gap-3 p-4 bg-slate-50 rounded-xl border border-slate-200">
            {[
              { label: "Cd", value: fc?.Cd?.toFixed(3) ?? "–" },
              { label: "Cl", value: fc?.Cl?.toFixed(3) ?? "–" },
              { label: "Noise", value: results?.noise_spl_db ? `${results.noise_spl_db.toFixed(0)} dB` : "–" },
            ].map(({ label, value }) => (
              <div key={label} className="text-center">
                <p className="text-xs text-gray-500">{label}</p>
                <p className="text-lg font-bold text-slate-800 font-mono">{value}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Actions */}
        <div className="flex gap-3 px-6 pb-5">
          <button
            onClick={onClose}
            className="flex-1 py-2.5 rounded-xl border border-gray-200 text-gray-600 text-sm font-medium hover:bg-gray-50 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleDownload}
            disabled={generating}
            className="flex-1 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold flex items-center justify-center gap-2 transition-colors disabled:opacity-60"
          >
            {generating ? (
              <>
                <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
                </svg>
                Generating…
              </>
            ) : (
              <>
                <Download className="w-4 h-4" />
                Download PDF
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── PDF helpers ───────────────────────────────────────────────────────────────

function sectionTitle(doc, text, y) {
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.setTextColor(37, 99, 235);
  doc.text(text, 15, y);
  doc.setDrawColor(37, 99, 235);
  doc.setLineWidth(0.3);
  doc.line(15, y + 1.5, 195, y + 1.5);
  doc.setTextColor(30, 30, 30);
}

function dataTable(doc, rows, x, y, colWidth, headers = null) {
  const rowH = 6;
  const c1   = colWidth * 0.48;
  const c2   = colWidth * 0.52;

  doc.setFontSize(8);

  if (headers) {
    doc.setFont("helvetica", "bold");
    doc.setFillColor(241, 245, 249);
    doc.rect(x, y - 4, colWidth, rowH, "F");
    headers.forEach((h, i) => {
      doc.text(h, x + i * (colWidth / headers.length) + 1, y);
    });
    y += rowH;
  }

  rows.forEach(([label, value], idx) => {
    if (idx % 2 === 0) {
      doc.setFillColor(248, 250, 252);
      doc.rect(x, y - 4, colWidth, rowH, "F");
    }
    doc.setFont("helvetica", "bold");   doc.text(String(label), x + 1, y);
    doc.setFont("helvetica", "normal"); doc.text(String(value), x + c1, y);
    y += rowH;
  });

  return y;
}

function formatNum(n) {
  return new Intl.NumberFormat("en-US", { notation: "scientific", maximumFractionDigits: 2 }).format(n);
}
