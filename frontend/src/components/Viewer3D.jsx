/**
 * Viewer3D
 * ─────────
 * Interactive 3D CFD results viewer using vtk.js.
 *
 * Renders:
 *   - Surface mesh coloured by pressure (vtk_surface_url → .vtp)
 *   - Volume field clip plane (vtk_volume_url → .vtu)   [optional]
 *   - Streamlines (streamlines_url → .vtp)               [optional]
 *
 * All loaded files must be hosted on the same origin (served by FastAPI's
 * /api/results/static/ mount) to avoid CORS issues.
 *
 * Props:
 *   surfaceUrl    {string|null}
 *   volumeUrl     {string|null}
 *   streamlineUrl {string|null}
 */
import React, { useEffect, useRef, useState } from "react";
import "@kitware/vtk.js/Rendering/Profiles/Geometry";

import vtkFullScreenRenderWindow from "@kitware/vtk.js/Rendering/Misc/FullScreenRenderWindow";
import vtkActor                  from "@kitware/vtk.js/Rendering/Core/Actor";
import vtkMapper                 from "@kitware/vtk.js/Rendering/Core/Mapper";
import vtkXMLPolyDataReader      from "@kitware/vtk.js/IO/XML/XMLPolyDataReader";
import vtkColorTransferFunction  from "@kitware/vtk.js/Rendering/Core/ColorTransferFunction";
import vtkScalarBarActor         from "@kitware/vtk.js/Rendering/Core/ScalarBarActor";
import vtkColorMaps              from "@kitware/vtk.js/Rendering/Core/ColorTransferFunction/ColorMaps";

const COLORMAP = "Cool to Warm";   // vtkColorMaps preset

// ─────────────────────────────────────────────────────────────────────────────
// Async helpers
// ─────────────────────────────────────────────────────────────────────────────

async function loadPolyData(url) {
  const reader = vtkXMLPolyDataReader.newInstance();
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP ${response.status} fetching ${url}`);
  const arrayBuffer = await response.arrayBuffer();
  reader.parseAsArrayBuffer(arrayBuffer);
  return reader.getOutputData(0);
}

function buildColorTransferFunction(dataRange) {
  const ctf = vtkColorTransferFunction.newInstance();
  const preset = vtkColorMaps.getPresetByName(COLORMAP);
  if (preset) {
    ctf.applyColorMap(preset);
  } else {
    // Fallback blue → red
    ctf.addRGBPoint(dataRange[0], 0.0, 0.0, 1.0);
    ctf.addRGBPoint(dataRange[1], 1.0, 0.0, 0.0);
  }
  ctf.setMappingRange(...dataRange);
  ctf.updateRange();
  return ctf;
}

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────

export default function Viewer3D({ surfaceUrl, volumeUrl, streamlineUrl }) {
  const containerRef = useRef(null);
  const vtkContext   = useRef(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(null);
  const [activeField, setActiveField] = useState("p");  // "p" or "U_mag"

  useEffect(() => {
    if (!containerRef.current) return;

    // ── Initialise vtk.js renderer ──────────────────────────────────────
    const fullScreenRenderer = vtkFullScreenRenderWindow.newInstance({
      rootContainer: containerRef.current,
      containerStyle: { width: "100%", height: "100%", background: "#1a1a2e" },
      background: [0.1, 0.1, 0.18],
    });

    const renderer = fullScreenRenderer.getRenderer();
    const renderWindow = fullScreenRenderer.getRenderWindow();

    renderer.setBackground(0.1, 0.1, 0.18);
    vtkContext.current = { fullScreenRenderer, renderer, renderWindow };

    const actors = [];

    // ── Load surface geometry ───────────────────────────────────────────
    const loadData = async () => {
      try {
        // 1. Surface with pressure colouring
        if (surfaceUrl) {
          const polyData = await loadPolyData(surfaceUrl);
          const pointData = polyData.getPointData();
          const pArray = pointData.getArrayByName("p");

          const mapper = vtkMapper.newInstance({ interpolateScalarsBeforeMapping: true });
          mapper.setInputData(polyData);

          if (pArray) {
            const range = pArray.getRange();
            const ctf = buildColorTransferFunction(range);
            mapper.setColorModeToMapScalars();
            mapper.setColorByArrayName("p");
            mapper.setScalarModeToUsePointFieldData();
            mapper.getLookupTable().setVectorModeToMagnitude();
            mapper.setLookupTable(ctf);
            mapper.setScalarRange(...range);
          }

          const actor = vtkActor.newInstance();
          actor.setMapper(mapper);
          renderer.addActor(actor);
          actors.push(actor);
        }

        // 2. Streamlines
        if (streamlineUrl) {
          const slData = await loadPolyData(streamlineUrl);
          const uArray = slData.getPointData().getArrayByName("U_mag") ||
                         slData.getPointData().getArrayByName("U");

          const mapper = vtkMapper.newInstance({ interpolateScalarsBeforeMapping: true });
          mapper.setInputData(slData);

          if (uArray) {
            const range = uArray.getRange();
            const ctf = buildColorTransferFunction(range);
            mapper.setColorByArrayName(uArray.getName());
            mapper.setScalarModeToUsePointFieldData();
            mapper.setLookupTable(ctf);
            mapper.setScalarRange(...range);
          }

          const actor = vtkActor.newInstance();
          actor.setMapper(mapper);
          actor.getProperty().setLineWidth(1.5);
          renderer.addActor(actor);
          actors.push(actor);
        }

        renderer.resetCamera();
        renderer.getActiveCamera().elevation(15);
        renderer.getActiveCamera().azimuth(-30);
        renderer.resetCameraClippingRange();
        renderWindow.render();

        setLoading(false);
      } catch (err) {
        console.error("3D viewer error:", err);
        setError(err.message);
        setLoading(false);
      }
    };

    loadData();

    // ── Cleanup ─────────────────────────────────────────────────────────
    return () => {
      actors.forEach((a) => renderer.removeActor(a));
      fullScreenRenderer.delete();
      vtkContext.current = null;
    };
  }, [surfaceUrl, streamlineUrl]);

  // ─────────────────────────────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────────────────────────────

  return (
    <div className="relative w-full h-full">
      {/* VTK container */}
      <div ref={containerRef} className="w-full h-full" />

      {/* Loading overlay */}
      {loading && !error && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-gray-900/80 z-10">
          <svg className="animate-spin w-10 h-10 text-blue-400" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
          </svg>
          <p className="text-blue-300 mt-3 text-sm">Loading 3D results…</p>
        </div>
      )}

      {/* Error overlay */}
      {error && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-gray-900/90 z-10 p-6">
          <p className="text-red-400 font-semibold mb-2">Could not load 3D data</p>
          <p className="text-red-300 text-sm text-center">{error}</p>
        </div>
      )}

      {/* Legend / controls */}
      {!loading && !error && (
        <div className="absolute bottom-4 left-4 bg-black/50 rounded-lg p-3 text-white text-xs space-y-1 backdrop-blur-sm">
          <p className="font-semibold text-blue-300">Colour: Pressure (Pa)</p>
          <div className="flex items-center gap-1">
            <div
              className="w-24 h-3 rounded"
              style={{
                background: "linear-gradient(to right, #0000ff, #00ffff, #ffff00, #ff0000)",
              }}
            />
          </div>
          <div className="flex justify-between w-24 text-gray-400">
            <span>low</span>
            <span>high</span>
          </div>
          <p className="text-gray-400 pt-1">Left-drag: rotate</p>
          <p className="text-gray-400">Right-drag: pan</p>
          <p className="text-gray-400">Scroll: zoom</p>
        </div>
      )}
    </div>
  );
}
