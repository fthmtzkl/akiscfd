/**
 * GeometryViewer3D – Three.js based CFD results visualiser.
 *
 * Visual modes:
 *   geometry   – plain shaded model (blue)
 *   pressure   – surface Cp (blue=suction → red=stagnation)
 *   friction   – wall shear stress magnitude
 *   drag       – local drag contribution per face
 *   noise      – estimated SPL per surface element
 *   streamlines– potential-flow streamlines around body
 *   wireframe  – mesh wireframe overlay (can be combined with any mode)
 *
 * Props:
 *   geometryUrl  {string}
 *   filename     {string}
 *   windAngleDeg {number}   0–360
 *   windSpeed    {number}   m/s
 *   visualMode   {string}   see above
 *   showWireframe{boolean}
 *   showWindArrow{boolean}
 *   captureRef   {object}   set to () => canvas.toDataURL()
 *   onMeshInfo   {function} called with {vertices,faces,dimX,dimY,dimZ,area}
 */
import React, { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

// ── Colormap: value 0→1 maps to HSL(240°→0°, full saturation) ────────────────
function valueToColor(t, color = new THREE.Color()) {
  color.setHSL((1 - Math.max(0, Math.min(1, t))) * 0.66, 1.0, 0.5);
  return color;
}

// ── Per-vertex color computation for each mode ────────────────────────────────
function computeVertexColors(geometry, mode, windDir, windSpeed) {
  const positions = geometry.attributes.position;
  const normals   = geometry.attributes.normal;
  const count     = positions.count;
  const colors    = new Float32Array(count * 3);
  const col       = new THREE.Color();
  const n         = new THREE.Vector3();

  const RHO = 1.225, NU = 1.5e-5, PREF = 2e-5;
  const q   = 0.5 * RHO * windSpeed * windSpeed;
  const Re  = windSpeed * 4 / NU;
  const Cf0 = 0.074 / Math.pow(Re, 0.2); // mean skin friction

  for (let i = 0; i < count; i++) {
    n.set(normals.getX(i), normals.getY(i), normals.getZ(i)).normalize();
    const dot = windDir.dot(n); // -1 leeward, +1 windward

    let t = 0.5; // default mid

    switch (mode) {
      case "pressure": {
        // Cp model: stagnation point Cp=1, leeward Cp≈-0.5
        const Cp = dot > 0 ? dot : dot * 0.45;
        t = (Cp + 0.45) / 1.45;
        break;
      }
      case "friction": {
        // τ ∝ tangential velocity component → |n × windDir|
        const tang = new THREE.Vector3().crossVectors(n, windDir).length();
        const Cf_local = Cf0 * (1 + tang * 0.5);
        t = Math.min(Cf_local / (Cf0 * 1.8), 1.0);
        break;
      }
      case "drag": {
        // Local drag = pressure drag + friction drag (in wind direction)
        const Cp = dot > 0 ? dot : dot * 0.45;
        const pressureDrag = Cp * dot;           // pressure component
        const tang = new THREE.Vector3().crossVectors(n, windDir).length();
        const frictionDrag = Cf0 * tang;          // friction component
        const totalDrag = pressureDrag + frictionDrag;
        t = (totalDrag + 0.1) / 1.1;
        break;
      }
      case "noise": {
        // SPL estimate: higher friction velocity → more trailing-edge noise
        const tang = new THREE.Vector3().crossVectors(n, windDir).length();
        const v_surface = tang * windSpeed;
        const p_rms = RHO * v_surface * v_surface * 0.008;
        const spl = p_rms > 1e-10 ? 20 * Math.log10(p_rms / PREF) : 0;
        // Map typical range 40–90 dB to 0–1
        t = Math.max(0, Math.min(1, (spl - 40) / 50));
        break;
      }
      default: {
        // geometry – flat blue
        col.set(0x3b82f6);
        colors[i * 3]     = col.r;
        colors[i * 3 + 1] = col.g;
        colors[i * 3 + 2] = col.b;
        continue;
      }
    }

    valueToColor(t, col);
    colors[i * 3]     = col.r;
    colors[i * 3 + 1] = col.g;
    colors[i * 3 + 2] = col.b;
  }

  if (geometry.attributes.color) {
    geometry.attributes.color.array.set(colors);
    geometry.attributes.color.needsUpdate = true;
  } else {
    geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  }
}

// ── Potential-flow streamline tracing ─────────────────────────────────────────

function potentialFlowVelocity(pos, windDir, R) {
  const r = pos.length();
  if (r < R * 0.85) return windDir.clone().multiplyScalar(0.001);
  const R3 = R * R * R;
  const r3 = r * r * r;
  const rHat = pos.clone().normalize();
  const wDotR = windDir.dot(rHat);
  const perturb = rHat.clone().multiplyScalar(3 * wDotR).sub(windDir.clone())
    .multiplyScalar(R3 / (2 * r3));
  return windDir.clone().add(perturb);
}

function traceStreamline(seed, windDir, R, steps = 220, dt = 0.18) {
  const pts = [seed.clone()];
  let pos = seed.clone();
  for (let i = 0; i < steps; i++) {
    const v = potentialFlowVelocity(pos, windDir, R);
    const spd = v.length();
    if (spd < 1e-4) break;
    pos = pos.clone().addScaledVector(v.normalize(), dt);
    pts.push(pos.clone());
    if (pos.dot(windDir) > R * 4.5) break;
  }
  return pts;
}

function buildStreamlineObjects(windDir, R) {
  const group = new THREE.Group();
  const mat   = new THREE.LineBasicMaterial({ color: 0x00cfff, transparent: true, opacity: 0.7 });

  // Seed grid perpendicular to wind
  const right = new THREE.Vector3(0, 1, 0).cross(windDir).normalize();
  const up    = windDir.clone().cross(right).normalize();
  const rows  = 6, cols = 5;
  const span  = R * 2.2;

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const py = ((r / (rows - 1)) - 0.5) * 2 * span;
      const pz = ((c / (cols - 1)) - 0.5) * 2 * span;
      // Start upstream
      const seed = windDir.clone().multiplyScalar(-(R * 3.5))
        .addScaledVector(up,    py)
        .addScaledVector(right, pz);

      const pts = traceStreamline(seed, windDir, R);
      if (pts.length < 3) continue;

      const geo = new THREE.BufferGeometry().setFromPoints(pts);
      group.add(new THREE.Line(geo, mat));
    }
  }
  return group;
}

// ── Legend labels per mode ────────────────────────────────────────────────────
const MODE_META = {
  geometry:   { label: "Geometry",       unit: "",      low: "",          high: "" },
  pressure:   { label: "Pressure (Cp)",  unit: "Cp",    low: "Suction (−0.45)", high: "Stagnation (+1.0)" },
  friction:   { label: "Wall Friction",  unit: "Cf",    low: "Low shear",  high: "High shear" },
  drag:       { label: "Drag (local)",   unit: "Cd",    low: "Low drag",   high: "High drag" },
  noise:      { label: "Noise (SPL)",    unit: "dB(A)", low: "40 dB",      high: "90 dB" },
  streamlines:{ label: "Streamlines",    unit: "",      low: "",           high: "" },
};

// ─────────────────────────────────────────────────────────────────────────────
// Main component
// ─────────────────────────────────────────────────────────────────────────────

export default function GeometryViewer3D({
  geometryUrl,
  filename     = "model.stl",
  windAngleDeg = 0,
  windSpeed    = 20,
  visualMode   = "geometry",
  showWireframe = false,
  showWindArrow = true,
  captureRef,
  onMeshInfo,
}) {
  const mountRef         = useRef(null);
  const rendererRef      = useRef(null);
  const sceneRef         = useRef(null);
  const cameraRef        = useRef(null);
  const controlsRef      = useRef(null);
  const meshRef          = useRef(null);
  const geometryRef      = useRef(null);
  const wireframeRef     = useRef(null);
  const streamGroupRef   = useRef(null);
  const windGroupRef     = useRef(null);
  const windAngleRef     = useRef(windAngleDeg);
  const windSpeedRef     = useRef(windSpeed);
  const modelRadiusRef   = useRef(3);
  const animIdRef        = useRef(null);

  const [status, setStatus]   = useState("loading");
  const [errorMsg, setErrorMsg] = useState("");

  // Sync refs without re-rendering scene
  useEffect(() => { windAngleRef.current = windAngleDeg; }, [windAngleDeg]);
  useEffect(() => { windSpeedRef.current = windSpeed; },   [windSpeed]);

  // ── Expose screenshot capture ──
  useEffect(() => {
    if (captureRef && rendererRef.current) {
      captureRef.current = () => {
        rendererRef.current.render(sceneRef.current, cameraRef.current);
        return rendererRef.current.domElement.toDataURL("image/png");
      };
    }
  });

  // ── Scene bootstrap (runs once per geometryUrl) ──────────────────────────
  useEffect(() => {
    if (!mountRef.current || !geometryUrl) return;
    let mounted = true;
    setStatus("loading");
    setErrorMsg("");

    const el = mountRef.current;
    const w  = el.clientWidth  || 700;
    const h  = el.clientHeight || 500;

    const scene    = new THREE.Scene();
    scene.background = new THREE.Color(0x0f1117);
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(45, w / h, 0.001, 1_000_000);
    camera.position.set(10, 6, 10);
    cameraRef.current = camera;

    let renderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    } catch (e) {
      setErrorMsg("WebGL not available in this browser.");
      setStatus("error");
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(w, h);
    renderer.shadowMap.enabled = true;
    el.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.07;
    controlsRef.current = controls;

    // Lights
    scene.add(new THREE.AmbientLight(0xffffff, 0.5));
    const sun = new THREE.DirectionalLight(0xffffff, 0.85);
    sun.position.set(10, 20, 10);
    sun.castShadow = true;
    scene.add(sun);
    const backLight = new THREE.DirectionalLight(0x8899ff, 0.25);
    backLight.position.set(-10, -5, -10);
    scene.add(backLight);

    // Grid + axes
    const grid = new THREE.GridHelper(40, 40, 0x223344, 0x1a2840);
    grid.material.opacity = 0.4;
    grid.material.transparent = true;
    scene.add(grid);
    scene.add(new THREE.AxesHelper(3));

    // Axis sprites
    [["X","#ff4444",[3.2,0,0]],["Y","#44ee44",[0,3.2,0]],["Z","#4488ff",[0,0,3.2]]].forEach(([t,c,p])=>{
      const cv=document.createElement("canvas"); cv.width=48; cv.height=28;
      const cx=cv.getContext("2d"); cx.fillStyle=c; cx.font="bold 20px Arial"; cx.fillText(t,8,22);
      const sp=new THREE.Sprite(new THREE.SpriteMaterial({map:new THREE.CanvasTexture(cv),sizeAttenuation:false}));
      sp.scale.set(0.065,0.038,1); sp.position.set(...p); scene.add(sp);
    });

    // Wind arrow group
    const windGroup = new THREE.Group();
    scene.add(windGroup);
    windGroupRef.current = windGroup;

    // Streamlines group placeholder
    const streamGroup = new THREE.Group();
    scene.add(streamGroup);
    streamGroupRef.current = streamGroup;

    // ── Load STL ────────────────────────────────────────────────────────────
    new STLLoader().load(
      geometryUrl,
      (geo) => {
        if (!mounted) return; // StrictMode: ignore stale callbacks after cleanup
        geo.computeBoundingBox();
        const box  = geo.boundingBox;
        const center = new THREE.Vector3(); box.getCenter(center);
        const size   = new THREE.Vector3(); box.getSize(size);
        const maxDim = Math.max(size.x, size.y, size.z) || 1;
        const scale  = 4 / maxDim;

        geo.translate(-center.x, -center.y, -center.z);
        geo.computeVertexNormals();
        geometryRef.current = geo;

        // Pre-allocate vertex color array
        const count = geo.attributes.position.count;
        geo.setAttribute("color", new THREE.BufferAttribute(new Float32Array(count * 3).fill(0.23), 3));

        const mat = new THREE.MeshPhongMaterial({
          vertexColors: true,
          specular: 0x112244,
          shininess: 45,
          side: THREE.DoubleSide,
        });

        const mesh = new THREE.Mesh(geo, mat);
        mesh.scale.setScalar(scale);
        mesh.castShadow = true;
        scene.add(mesh);
        meshRef.current = mesh;

        // Wireframe (hidden initially)
        const wfGeo = new THREE.WireframeGeometry(geo);
        const wfMat = new THREE.LineBasicMaterial({ color: 0x00ff88, transparent: true, opacity: 0.25 });
        const wfMesh = new THREE.LineSegments(wfGeo, wfMat);
        wfMesh.scale.setScalar(scale);
        wfMesh.visible = false;
        scene.add(wfMesh);
        wireframeRef.current = wfMesh;

        // Camera fit
        const R = (maxDim / 2) * scale;
        modelRadiusRef.current = R;
        const dist = R * 4;
        camera.position.set(dist, dist * 0.6, dist);
        camera.lookAt(0, 0, 0);
        controls.maxDistance = dist * 15;
        controls.target.set(0, 0, 0);
        controls.update();
        grid.position.y = -R - 0.1;

        // Report mesh info
        const scaledSize = size.clone().multiplyScalar(scale);
        onMeshInfo?.({
          vertices: count,
          faces:    Math.floor(count / 3),
          dimX:     +scaledSize.x.toFixed(2),
          dimY:     +scaledSize.y.toFixed(2),
          dimZ:     +scaledSize.z.toFixed(2),
          area:     +(Math.PI * R * R * 4).toFixed(2),
        });

        setStatus("ready");
      },
      undefined,
      (err) => {
        if (!mounted) return;
        setErrorMsg(err?.message ?? "Failed to load");
        setStatus("error");
      }
    );

    // ── Animation loop ───────────────────────────────────────────────────────
    const animate = () => {
      animIdRef.current = requestAnimationFrame(animate);
      controls.update();

      // Wind arrow (rebuilt every frame from ref)
      const wg = windGroupRef.current;
      if (showWindArrow && wg) {
        wg.clear();
        const a   = THREE.MathUtils.degToRad(windAngleRef.current);
        const dir = new THREE.Vector3(Math.cos(a), 0, -Math.sin(a));
        const R   = modelRadiusRef.current;
        const ori = dir.clone().multiplyScalar(-(R * 2.5 + 4));
        ori.y = R * 0.3;
        const len = R * 1.5 + 3;
        wg.add(new THREE.ArrowHelper(dir, ori, len, 0x00aaff, len * 0.18, len * 0.1));
      }

      renderer.render(scene, camera);
    };
    animate();

    // Resize observer
    const obs = new ResizeObserver(() => {
      const rw = el.clientWidth, rh = el.clientHeight;
      if (!rw || !rh) return;
      camera.aspect = rw / rh;
      camera.updateProjectionMatrix();
      renderer.setSize(rw, rh);
    });
    obs.observe(el);

    return () => {
      mounted = false;
      cancelAnimationFrame(animIdRef.current);
      obs.disconnect();
      controls.dispose();
      renderer.dispose();
      geometryRef.current = null;
      meshRef.current = null;
      wireframeRef.current = null;
      if (renderer.domElement.parentNode === el) el.removeChild(renderer.domElement);
    };
  }, [geometryUrl, filename]);

  // ── React to visualMode / windAngleDeg / windSpeed changes ──────────────────
  useEffect(() => {
    const geo  = geometryRef.current;
    const mesh = meshRef.current;
    const sg   = streamGroupRef.current;
    const wfm  = wireframeRef.current;
    if (!geo || !mesh) return;

    const a   = THREE.MathUtils.degToRad(windAngleDeg);
    const dir = new THREE.Vector3(Math.cos(a), 0, -Math.sin(a));

    // Streamlines
    if (sg) {
      sg.clear();
      if (visualMode === "streamlines") {
        sg.add(buildStreamlineObjects(dir, modelRadiusRef.current));
      }
    }

    // Vertex colors
    if (visualMode !== "streamlines") {
      computeVertexColors(geo, visualMode, dir, windSpeed);
    }

    // Wireframe
    if (wfm) wfm.visible = showWireframe;

  }, [visualMode, windAngleDeg, windSpeed, showWireframe]);

  const meta = MODE_META[visualMode] ?? MODE_META.geometry;
  const showLegend = visualMode !== "geometry" && visualMode !== "streamlines";

  return (
    <div className="relative w-full h-full bg-gray-950 rounded-xl overflow-hidden select-none">
      <div ref={mountRef} className="w-full h-full" />

      {/* Loading */}
      {status === "loading" && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-gray-950/90 z-10">
          <svg className="animate-spin w-9 h-9 text-blue-400" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
          </svg>
          <p className="text-blue-300 mt-2 text-sm">Loading geometry…</p>
        </div>
      )}

      {/* Error */}
      {status === "error" && (
        <div className="absolute inset-0 flex items-center justify-center bg-gray-950/90 z-10">
          <p className="text-red-400 text-sm px-4 text-center">{errorMsg}</p>
        </div>
      )}

      {/* Wind badge */}
      {status === "ready" && showWindArrow && (
        <div className="absolute top-3 left-3 flex items-center gap-2 bg-black/55 rounded-lg px-2.5 py-1.5 backdrop-blur-sm">
          <div className="w-2 h-2 rounded-full bg-blue-400" />
          <span className="text-xs text-white font-medium">
            Wind <span className="font-mono text-blue-300">{Math.round(windAngleDeg)}°</span>
          </span>
        </div>
      )}

      {/* Mode badge */}
      {status === "ready" && visualMode !== "geometry" && (
        <div className="absolute top-3 right-3 bg-black/55 rounded-lg px-2.5 py-1.5 backdrop-blur-sm">
          <p className="text-xs text-white font-semibold">{meta.label}</p>
        </div>
      )}

      {/* Color legend */}
      {status === "ready" && showLegend && (
        <div className="absolute bottom-10 right-3 bg-black/60 rounded-lg px-3 py-2 backdrop-blur-sm min-w-[130px]">
          <p className="text-xs text-white font-semibold mb-1">{meta.label} {meta.unit && `(${meta.unit})`}</p>
          <div
            className="w-full h-2.5 rounded mb-1"
            style={{ background: "linear-gradient(to right,#0040ff,#00cfff,#ffff00,#ff2200)" }}
          />
          <div className="flex justify-between text-xs text-gray-400">
            <span>{meta.low}</span>
            <span>{meta.high}</span>
          </div>
        </div>
      )}

      {/* Controls hint */}
      {status === "ready" && (
        <div className="absolute bottom-3 right-3 text-xs text-gray-600 bg-black/30 rounded px-2 py-0.5 backdrop-blur-sm">
          Drag · Scroll · Right-drag
        </div>
      )}
    </div>
  );
}
