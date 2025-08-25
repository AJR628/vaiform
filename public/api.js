import { API_ROOT } from "./config.js";

// Optional: pages can set a token provider explicitly
let tokenProvider = null;
export function setTokenProvider(fn) {
  tokenProvider = typeof fn === "function" ? fn : null;
}

async function resolveIdToken() {
  try {
    if (tokenProvider) return await tokenProvider();
    if (typeof getIdToken === "function") return await getIdToken(); // legacy global, if present
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

  const res = await fetch(`${API_ROOT}${path}`, { ...opts, headers, credentials: "omit" });
  if (!res.ok) {
    let detail = "";
    try { detail = await res.text(); } catch {}
    throw new Error(`HTTP ${res.status}${detail ? `: ${detail}` : ""}`);
  }
  const ct = res.headers.get("content-type") || "";
  return ct.includes("application/json") ? res.json() : res.text();
}
