/**
 * API service layer – wraps all backend calls.
 *
 * Base URL is read from the Vite env variable VITE_API_BASE_URL
 * (set to http://localhost:8000/api in development).
 */
import axios from "axios";

const BASE_URL = import.meta.env.VITE_API_BASE_URL || "/api";

const http = axios.create({
  baseURL: BASE_URL,
  timeout: 30_000,
  headers: { "Content-Type": "application/json" },
});

// Attach JWT token to every request when present
http.interceptors.request.use((config) => {
  const token = localStorage.getItem("akiscfd_token");
  if (token) config.headers["Authorization"] = `Bearer ${token}`;
  return config;
});

// ─────────────────────────────────────────────────────────────────────────────
// Interceptors
// ─────────────────────────────────────────────────────────────────────────────

http.interceptors.response.use(
  (res) => res,
  (err) => {
    const detail =
      err.response?.data?.detail ||
      err.response?.data?.message ||
      err.message;
    console.error("[API error]", detail);
    return Promise.reject(new Error(detail));
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// Upload
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Upload a geometry file (STL / OBJ / STEP).
 * @param {File} file
 * @param {function} onProgress  – called with (percentComplete: number)
 * @returns {Promise<{geometry_id, filename, file_size_bytes, message}>}
 */
export async function uploadGeometry(file, onProgress) {
  const form = new FormData();
  form.append("file", file);

  const { data } = await http.post("/upload/geometry", form, {
    headers: { "Content-Type": "multipart/form-data" },
    onUploadProgress: (evt) => {
      if (onProgress && evt.total) {
        onProgress(Math.round((evt.loaded / evt.total) * 100));
      }
    },
  });
  return data;
}

/**
 * Delete an uploaded geometry.
 * @param {string} geometryId
 */
export async function deleteGeometry(geometryId) {
  await http.delete(`/upload/geometry/${geometryId}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Simulation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Submit a CFD simulation job.
 * @param {{
 *   geometry_id: string,
 *   wind_speed: number,
 *   wind_angle_deg: number,
 *   turbulence_model: string,
 *   mesh_quality: string,
 *   num_iterations: number
 * }} params
 * @returns {Promise<{job_id, status, message, created_at}>}
 */
export async function submitSimulation(params) {
  const { data } = await http.post("/simulate", params);
  return data;
}

/**
 * Poll job status.
 * @param {string} jobId
 * @returns {Promise<{job_id, status, progress_percent, current_step, error_message, results}>}
 */
export async function getJobStatus(jobId) {
  const { data } = await http.get(`/simulate/${jobId}/status`);
  return data;
}

/**
 * Open a Server-Sent Events stream for real-time progress updates.
 *
 * @param {string} jobId
 * @param {{ onMessage: function, onError: function, onDone: function }} callbacks
 * @returns {EventSource}  – call .close() to stop
 */
export function streamJobProgress(jobId, { onMessage, onError, onDone }) {
  const url = `${BASE_URL}/simulate/${jobId}/stream`;
  const es = new EventSource(url);

  es.onmessage = (evt) => {
    try {
      const payload = JSON.parse(evt.data);
      onMessage?.(payload);
      const terminal = ["completed", "failed"];
      if (terminal.includes(payload.status)) {
        es.close();
        onDone?.(payload);
      }
    } catch (e) {
      onError?.(e);
    }
  };

  es.onerror = (err) => {
    onError?.(err);
    es.close();
  };

  return es;
}

// ─────────────────────────────────────────────────────────────────────────────
// Results
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Fetch full results for a completed job.
 * @param {string} jobId
 */
export async function getResults(jobId) {
  const { data } = await http.get(`/results/${jobId}`);
  return data;
}

/**
 * Fetch residual history.
 * @param {string} jobId
 */
export async function getResiduals(jobId) {
  const { data } = await http.get(`/results/${jobId}/residuals`);
  return data.residuals ?? [];
}

/**
 * Delete a job and all associated data.
 * @param {string} jobId
 */
export async function deleteJob(jobId) {
  await http.delete(`/results/${jobId}`);
}

/**
 * Build the URL to stream the raw geometry file for 3D preview.
 * @param {string} geometryId
 */
export function getGeometryFileUrl(geometryId) {
  if (!geometryId) return null;
  return `${BASE_URL}/upload/geometry/${geometryId}/file`;
}

/**
 * Build the full URL to download a VTK file.
 * @param {string} relativePath  – as returned in results.vtk_surface_url etc.
 */
export function getVtkFileUrl(relativePath) {
  if (!relativePath) return null;
  if (relativePath.startsWith("http")) return relativePath;
  return `${BASE_URL}/results/static/${relativePath.replace(/^results\/[^/]+\//, "")}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Health
// ─────────────────────────────────────────────────────────────────────────────

export async function checkHealth() {
  const { data } = await http.get("/health");
  return data;
}
