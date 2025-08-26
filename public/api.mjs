// Version stamp for debugging:
console.info("[api.js] v3", { path: import.meta.url });

import { API_ROOT } from "./js/config.js";
import { BACKEND } from "./js/config.js";

// Optional: pages can set a token provider explicitly
let tokenProvider = null;
export function setTokenProvider(fn) {
  tokenProvider = typeof fn === "function" ? fn : null;
}

function dlog(...args) {
  try {
    if (typeof window !== "undefined" && window.__VAIFORM_DEBUG__ === "1") {
      console.debug("[api.js]", ...args);
    }
  } catch {}
}

// Try to get a token immediately (no waiting)
async function immediateToken() {
  try {
    if (tokenProvider) {
      const t = await tokenProvider();
      dlog("token via tokenProvider:", !!t);
      if (t) return t;
    }
    if (typeof getIdToken === "function") {
      const t = await getIdToken(); // legacy/global helper
      dlog("token via global getIdToken:", !!t);
      if (t) return t;
    }
    if (typeof window !== "undefined") {
      const auth = window.auth || window.firebase?.auth?.();
      const user = auth?.currentUser;
      if (user?.getIdToken) {
        const t = await user.getIdToken();
        dlog("token via auth.currentUser.getIdToken:", !!t, "| user:", !!user);
        if (t) return t;
      } else {
        dlog("no user or no getIdToken on user yet");
      }
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

          // Prefer token-ready signal; fall back to auth state

          if (maybeAuth?.onIdTokenChanged) {

            unsub = maybeAuth.onIdTokenChanged(async (u) => {

              if (resolved) return;

              if (u?.getIdToken) {

                resolved = true;

                const t = await u.getIdToken();

                if (unsub) try { unsub(); } catch {}

                resolve(t);

              }

            });

          } else if (maybeAuth?.onAuthStateChanged) {

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
    // Poll as a fallback while waiting
    const iv = setInterval(async () => {
      const t = await immediateToken();
      if (t || Date.now() - start > timeoutMs) {
        clearInterval(iv);
        if (!resolved) {
          resolved = true;
          if (unsub) try { unsub(); } catch {}
          dlog("waitForToken: resolve via poll:", !!t, "elapsed:", Date.now() - start);
          resolve(t || null);
        }
      }
    }, 150);
    // Hard timeout guard
    setTimeout(() => {
      if (!resolved) {
        resolved = true;
        if (unsub) try { unsub(); } catch {}
        dlog("waitForToken: timeout elapsed with no token");
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

  // Never fire protected calls without a token

  if (needsAuth && !headers["Authorization"]) {

    const e = new Error("AUTH_NOT_READY");

    e.code = "AUTH_NOT_READY";

    throw e;

  }
  if (!headers["Content-Type"] && opts.body) headers["Content-Type"] = "application/json";

  const urlApi = `${API_ROOT}${path}`;
  dlog("fetch →", urlApi);
  let res = await fetch(urlApi, { ...opts, headers, credentials: "omit" });

  // Graceful fallback: if /api/* isn't mounted for simple GETs, try root once.
  const isGet = !opts.method || opts.method.toUpperCase() === "GET";
  const eligibleFallback =
    isGet && (path === "/credits" || path === "/whoami" || path === "/health");
  if (eligibleFallback && res.status === 404) {
    const urlRoot = BACKEND.replace(/\/$/, "") + path;
    dlog("fallback fetch →", urlRoot);
    res = await fetch(urlRoot, { ...opts, headers, credentials: "omit" });
  }

  if (!res.ok) {
    let detail = "";
    try { detail = await res.text(); } catch {}
    dlog("apiFetch error:", res.status, detail?.slice?.(0, 200));
    throw new Error(`HTTP ${res.status}${detail ? `: ${detail}` : ""}`);
  }
  const ct = res.headers.get("content-type") || "";
  return ct.includes("application/json") ? res.json() : res.text();
}

// Expose a tiny diag helper to poke from the console
try {
  if (typeof window !== "undefined") {
    window.__vaiform_diag__ = {
      async tokenNow() { return immediateToken(); },
      async tokenWait(ms=4000) { return waitForToken(ms); },
      async whoami() { return (await import("./api.mjs")).apiFetch("/whoami"); },
    };
  }
} catch {}
