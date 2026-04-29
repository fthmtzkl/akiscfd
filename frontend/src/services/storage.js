const KEY = "cfd_simulations";

export function getSimulations() {
  try { return JSON.parse(localStorage.getItem(KEY) || "[]"); }
  catch { return []; }
}

export function addSimulation(sim) {
  const sims = getSimulations();
  sims.unshift(sim);
  localStorage.setItem(KEY, JSON.stringify(sims));
}

export function updateSimulation(jobId, updates) {
  const sims = getSimulations();
  const idx = sims.findIndex(s => s.jobId === jobId);
  if (idx !== -1) {
    sims[idx] = { ...sims[idx], ...updates };
    localStorage.setItem(KEY, JSON.stringify(sims));
  }
}

export function deleteSimulation(jobId) {
  localStorage.setItem(KEY, JSON.stringify(getSimulations().filter(s => s.jobId !== jobId)));
}
