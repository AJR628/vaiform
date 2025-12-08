// Version stamp (print only if debug flag is set on window)
try { if (typeof window !== "undefined" && (window.__VAIFORM_DEBUG__ === "1" || window.VAIFORM_DEBUG === "1")) {
  console.info("[api.mjs] v4", { path: import.meta.url });
}} catch {}

// Use hardcoded constants to avoid Firebase initialization conflicts
const BACKEND_URL = "https://17e0d1d1-e327-483d-b1ea-c41bea08fb59-00-1ef93t84nlhq6.janeway.replit.dev/api";
const BACKEND = "https://17e0d1d1-e327-483d-b1ea-c41bea08fb59-00-1ef93t84nlhq6.janeway.replit.dev/";
const API_ROOT = BACKEND_URL;

// Allow pages to provide a token-getter (Firebase)
let tokenProvider = null;
export function setTokenProvider(fn) {
  tokenProvider = typeof fn === "function" ? fn : null;
}

function dlog(...args) {
  try {
    if (typeof window !== "undefined" && window.VAIFORM_DEBUG === "1") {
      console.debug("[api.mjs]", ...args);
    }
  } catch {}
}

function getAuthMaybe() {
  try {
    if (typeof window === "undefined") return null;
    return window.auth || window.firebase?.auth?.() || null;
  } catch { return null; }
}

// Try to get a token immediately (no waiting)
async function immediateToken() {
  try {
    if (tokenProvider) {
      const t = await tokenProvider();
      if (t) return t;
    }
    if (typeof getIdToken === "function") {
      const t = await getIdToken(); // legacy/global
      if (t) return t;
    }
    const auth = getAuthMaybe();
    const u = auth?.currentUser;
    if (u?.getIdToken) {
      return await u.getIdToken();
    }
  } catch {}
  return null;
}

// Wait briefly for Firebase auth to initialize (only when required)
async function waitForToken(timeoutMs = 4000) {
  const first = await immediateToken();
  if (first) return first;

  const start = Date.now();
  let done = false, unsub = null;
  const auth = getAuthMaybe();

  return await new Promise((resolve) => {
    try {
      if (auth?.onIdTokenChanged) {
        unsub = auth.onIdTokenChanged(async (u) => {
          if (done) return;
          if (u?.getIdToken) {
            done = true;
            try { unsub && unsub(); } catch {}
            resolve(await u.getIdToken());
          }
        });
      } else if (auth?.onAuthStateChanged) {
        unsub = auth.onAuthStateChanged(async (u) => {
          if (done) return;
          if (u?.getIdToken) {
            done = true;
            try { unsub && unsub(); } catch {}
            resolve(await u.getIdToken());
          }
        });
      }
    } catch {}

    // Poll as a fallback
    const iv = setInterval(async () => {
      const t = await immediateToken();
      if (done) return;
      if (t || Date.now() - start > timeoutMs) {
        done = true;
        clearInterval(iv);
        try { unsub && unsub(); } catch {}
        resolve(t || null);
      }
    }, 150);

    // Hard timeout guard
    setTimeout(() => {
      if (done) return;
      done = true;
      try { unsub && unsub(); } catch {}
      resolve(null);
    }, timeoutMs + 250);
  });
}

async function resolveIdToken(required = false) {
  const t = await immediateToken();
  if (t || !required) return t;
  return await waitForToken(4000);
}

export async function apiFetch(path, opts = {}) {
  const headers = { ...(opts.headers || {}) };
  const needsAuth =
    path === "/credits" ||
    path === "/whoami" ||
    path.startsWith("/generate") ||
    path.startsWith("/v2/") ||
    path.startsWith("/jobs") ||
    path.startsWith("/job") ||
    path.startsWith("/voice/") ||
    path.startsWith("/shorts/") ||
    path.startsWith("/quotes/") ||
    path.startsWith("/assets/") ||
    path.startsWith("/caption/") ||
    path.startsWith("/story/") ||
    path.startsWith("/users/");

  if (!headers["Authorization"]) {
    const tok = await resolveIdToken(!!needsAuth);
    if (tok) headers["Authorization"] = `Bearer ${tok}`;
  }

  if (needsAuth && !headers["Authorization"]) {
    const e = new Error("AUTH_NOT_READY");
    e.code = "AUTH_NOT_READY";
    throw e;
  }

  // Auto-add idempotency key for generate requests
  const isGeneratePost = path.startsWith("/generate") && (!opts.method || opts.method.toUpperCase() === "POST");
  if (isGeneratePost && !headers["X-Idempotency-Key"]) {
    headers["X-Idempotency-Key"] = `frontend-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  if (!headers["Content-Type"] && opts.body) headers["Content-Type"] = "application/json";

  // Stringify JSON bodies
  let body = opts.body;
  if (body && typeof body === "object" && !(body instanceof FormData) && !(body instanceof Blob)) {
    try { body = JSON.stringify(body); } catch {}
  }

  const urlApi = `${API_ROOT}${path}`;
  dlog("fetch →", urlApi);
  let res = await fetch(urlApi, { ...opts, body, headers, credentials: "omit" });

  // Graceful fallback for simple GETs if /api/* alias isn't mounted
  const isGet = !opts.method || opts.method.toUpperCase() === "GET";
  const eligibleFallback = isGet && (path === "/credits" || path === "/whoami" || path === "/health");
  if (eligibleFallback && res.status === 404) {
    const urlRoot = BACKEND.replace(/\/$/, "") + path;
    dlog("fallback fetch →", urlRoot);
    res = await fetch(urlRoot, { ...opts, headers, credentials: "omit" });
  }

  if (!res.ok) {
    const ct = res.headers.get("content-type") || "";
    if (ct.includes("application/json")) {
      try {
        const errorJson = await res.json();
        dlog("apiFetch error:", res.status, errorJson);
        // Return error object so callers can check resp.error or resp.code
        return errorJson;
      } catch {
        // Fallback if JSON parsing fails
        const detail = await res.text().catch(() => "");
        dlog("apiFetch error (non-JSON):", res.status, detail?.slice?.(0, 200));
        return {
          success: false,
          error: `HTTP_${res.status}`,
          detail: detail || `HTTP ${res.status}`,
        };
      }
    } else {
      const detail = await res.text().catch(() => "");
      dlog("apiFetch error:", res.status, detail?.slice?.(0, 200));
      return {
        success: false,
        error: `HTTP_${res.status}`,
        detail: detail || `HTTP ${res.status}`,
      };
    }
  }
  const ct = res.headers.get("content-type") || "";
  return ct.includes("application/json") ? res.json() : res.text();
}

// Expose tiny diag helpers for the console
try {
  if (typeof window !== "undefined") {
    window.vaiform_diag = {
      async tokenNow() { return immediateToken(); },
      async tokenWait(ms = 4000) { return waitForToken(ms); },
      async whoami() { return apiFetch("/whoami"); },
    };
  }
} catch {}
