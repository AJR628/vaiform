// Version stamp for debugging:
console.info("[api.js] v3", { path: import.meta.url });

import { API_ROOT } from "./config.js";
import { BACKEND } from "./config.js";

// Optional: pages can set a token provider explicitly
let tokenProvider = null;
export function setTokenProvider(fn) {
  tokenProvider = typeof fn === "function" ? fn : null;
}

// Try to get a token immediately (no waiting)
async function immediateToken() {
  try {
    if (tokenProvider) return await tokenProvider();
    if (typeof getIdToken === "function") return await getIdToken(); // legacy/global helper
    if (typeof window !== "undefined") {
      const auth = window.auth || window.firebase?.auth?.();
      const user = auth?.currentUser;
      if (user?.getIdToken) return await user.getIdToken();
    }
  } catch { /* ignore */ }
  return null;
}

// Wait briefly for Firebase auth to initialize (used only when needed)
async function waitForToken(timeoutMs = 4000) {
  const start = Date.now();
  // If it appears quickly, return early
  const first = await immediateToken();
  if (first) return first;
  // Attach listener if available
  let unsub = null, resolved = false;
  const maybeAuth = (typeof window !== "undefined") && (window.auth || window.firebase?.auth?.());
  const viaEvent = await new Promise((resolve) => {
    try {
      if (maybeAuth?.onAuthStateChanged) {
        unsub = maybeAuth.onAuthStateChanged(async (u) => {
          if (resolved) return;
          if (u?.getIdToken) {
            resolved = true;
            const t = await u.getIdToken();
            if (unsub) try { unsub(); } catch {}
            resolve(t);
          }
        });
      }
    } catch { /* ignore */ }
    // Poll as a fallback while waiting
    const iv = setInterval(async () => {
      const t = await immediateToken();
      if (t || Date.now() - start > timeoutMs) {
        clearInterval(iv);
        if (!resolved) {
          resolved = true;
          if (unsub) try { unsub(); } catch {}
          resolve(t || null);
        }
      }
    }, 150);
    // Hard timeout guard
    setTimeout(() => {
      if (!resolved) {
        resolved = true;
        if (unsub) try { unsub(); } catch {}
        resolve(null);
      }
    }, timeoutMs + 250);
  });
  return viaEvent;
}

async function resolveIdToken(required = false) {
  const t = await immediateToken();
  if (t || !required) return t;
  // Only block (briefly) when the endpoint requires auth
  return await waitForToken(4000);
}

export async function apiFetch(path, opts = {}) {
  const headers = { ...(opts.headers || {}) };
  // Endpoints that generally require auth
  const needsAuth =
    path === "/credits" ||
    path === "/whoami" ||
    path.startsWith("/generate") ||
    path.startsWith("/v2/") ||         // future: tts/avatar/etc.
    path.startsWith("/jobs");          // if you add jobs polling

  if (!headers["Authorization"]) {
    const tok = await resolveIdToken(!!needsAuth);
    if (tok) headers["Authorization"] = `Bearer ${tok}`;
  }
  if (!headers["Content-Type"] && opts.body) headers["Content-Type"] = "application/json";

  const urlApi = `${API_ROOT}${path}`;
  let res = await fetch(urlApi, { ...opts, headers, credentials: "omit" });

  // Graceful fallback: if /api/* isn't mounted for simple GETs, try root once.
  const isGet = !opts.method || opts.method.toUpperCase() === "GET";
  const eligibleFallback =
    isGet && (path === "/credits" || path === "/whoami" || path === "/health");
  if (eligibleFallback && res.status === 404) {
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
