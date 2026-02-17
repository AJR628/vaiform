// public/js/apiBase.js
// Unified API base configuration

// Use BACKEND_BASE from env.js if available, otherwise fall back to current origin
const API = (window.__ENV && window.__ENV.BACKEND_BASE) || window.location.origin;
console.log('[api] BACKEND_BASE =', API);

export const API_BASE = `${API}/api`;
