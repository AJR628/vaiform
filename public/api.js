// Version stamp for debugging:
console.info("[api.js] v3", { path: import.meta.url });

import { API_ROOT } from "./config.js";
import { BACKEND } from "./config.js";

// Optional: pages can set a token provider explicitly
let tokenProvider = null;
export function setTokenProvider(fn) {
  tokenProvider = typeof fn === "function" ? fn : null;
}

async function resolveIdToken() {
  try {
    if (tokenProvider) return await tokenProvider();
    // Probe safely for legacy/global helpers:
    if (typeof getIdToken === "function") return await getIdToken();
    if (typeof window !== "undefined") {
      const auth = window.auth || window.firebase?.auth?.();
      const user = auth?.currentUser;
      if (user?.getIdToken) return await user.getIdToken();
    }
  } catch { /* ignore */ }
  return null;
}

export async function apiFetch(path, opts = {}) {
  const headers = { ...(opts.headers || {}) };
  if (!headers["Authorization"]) {
    const tok = await resolveIdToken();
    if (tok) headers["Authorization"] = `Bearer ${tok}`;
  }
  if (!headers["Content-Type"] && opts.body) headers["Content-Type"] = "application/json";

  const urlApi = `${API_ROOT}${path}`;
  let res = await fetch(urlApi, { ...opts, headers, credentials: "omit" });

  // Graceful fallback: if /api/* isn't mounted for simple GETs, try root once.
  const isGet = !opts.method || opts.method.toUpperCase() === "GET";
  const eligible = isGet && (path === "/credits" || path === "/whoami" || path === "/health");
  if (eligible && res.status === 404) {
    const urlRoot = BACKEND.replace(/\/$/, "") + path;
    res = await fetch(urlRoot, { ...opts, headers, credentials: "omit" });
  }

  if (!res.ok) {
    let detail = "";
    try { detail = await res.text(); } catch {}
    throw new Error(`HTTP ${res.status}${detail ? `: ${detail}` : ""}`);
  }
  const ct = res.headers.get("content-type") || "";
  return ct.includes("application/json") ? res.json() : res.text();
}
