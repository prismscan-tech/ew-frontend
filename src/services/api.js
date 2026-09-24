// Thin wrapper around the Node/Express backend (ew-scheduler-backend), NOT
// the ML team's FastAPI service directly. The Node backend owns the session
// abstraction (start/pause/resume/complete), history persistence, and the
// WebSocket relay - see useSimulation.js for how sessions map to this UI's
// state, and ew-scheduler-backend/README.md for the full route list.
//
// Every function returns null on failure instead of throwing, so callers
// can fall back to demo data without wrapping every call in try/catch.

const BASE = import.meta.env.VITE_API_BASE_URL || '';

async function getJSON(path) {
  try {
    const res = await fetch(`${BASE}${path}`, { headers: { Accept: 'application/json' } });
    if (!res.ok) return null;
    return await res.json();
  } catch (err) {
    return null;
  }
}

async function postJSON(path, body) {
  try {
    const res = await fetch(`${BASE}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) return null;
    return await res.json().catch(() => ({}));
  } catch (err) {
    return null;
  }
}

export const api = {
  // Reference data (proxied by our backend from the ML API's catalogs)
  getScenarios: () => getJSON('/api/scenarios'),
  getSchedulers: () => getJSON('/api/schedulers'),
  getBenchmark: () => getJSON('/api/benchmark'),

  // Current telemetry snapshot, independent of any session we're tracking -
  // useful for an initial paint before a session exists.
  getCurrentTelemetry: () => getJSON('/api/telemetry'),

  // Our sessions API (see ew-scheduler-backend/src/routes/sessionsRoutes.ts)
  listSessions: () => getJSON('/sessions'),
  getSession: (sessionId) => getJSON(`/sessions/${sessionId}`),
  getSessionMetrics: (sessionId) => getJSON(`/sessions/${sessionId}/metrics`),
  getSessionHistory: (sessionId, limit) =>
    getJSON(`/sessions/${sessionId}/history${limit ? `?limit=${limit}` : ''}`),

  startSession: (scenarioName, schedulerName, seed, startPaused = false) =>
    postJSON('/sessions', { scenarioName, schedulerName, seed, startPaused }),
  pauseSession: (sessionId) => postJSON(`/sessions/${sessionId}/pause`),
  resumeSession: (sessionId) => postJSON(`/sessions/${sessionId}/resume`),
  completeSession: (sessionId) => postJSON(`/sessions/${sessionId}/complete`),
  // Manual step - needed in mock-ML mode (no real WS stream to auto-advance),
  // and usable as a "Step" button against the live backend too.
  stepSession: (sessionId, steps) => postJSON(`/sessions/${sessionId}/step`, { steps }),
  
  setSpeed: (sessionId, speed) => postJSON(`/sessions/${sessionId}/speed`, { speed }),
};

export function wsURL() {
  if (import.meta.env.VITE_API_BASE_URL) {
    // Replace http(s) with ws(s)
    return import.meta.env.VITE_API_BASE_URL.replace(/^http/, 'ws') + '/ws';
  }
  
  // Fallback for local proxy dev mode
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  // Our backend's relay socket - NOT the ML API's /ws/telemetry directly.
  return `${proto}//${window.location.host}/ws`;
}
