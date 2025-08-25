// Bridge Firebase auth → api.js token provider (works with compat or when window.auth is present)
import { setTokenProvider } from "./api.js";

function getAuthObj() {
  try {
    // Prefer any existing global
    if (window.auth) return window.auth;
    // Compat CDN style: window.firebase.auth()
    if (window.firebase?.auth) return window.firebase.auth();
  } catch {}
  return null;
}

function getUser() {
  const a = getAuthObj();
  return a?.currentUser || null;
}

// 1) Immediately expose found auth (once)
(function exposeAuth() {
  const a = getAuthObj();
  if (a && !window.auth) {
    try { window.auth = a; } catch {}
  }
})();

// 2) Set token provider now (may return null if not signed in yet)
setTokenProvider(async () => {
  const u = getUser();
  return u?.getIdToken ? u.getIdToken() : null;
});

// 3) Keep token provider in sync when auth state changes (if listener is available)
(function attachListener() {
  const a = getAuthObj();
  try {
    a?.onAuthStateChanged?.((u) => {
      setTokenProvider(async () => (u?.getIdToken ? u.getIdToken() : null));
    });
  } catch {}
})();

// 4) Gentle polling fallback in case auth attaches slightly later
(function pollForAuth(deadlineMs = 5000) {
  const deadline = Date.now() + deadlineMs;
  const iv = setInterval(() => {
    const a = getAuthObj();
    if (a) {
      try { if (!window.auth) window.auth = a; } catch {}
      // update provider based on current user
      const u = a.currentUser;
      setTokenProvider(async () => (u?.getIdToken ? u.getIdToken() : null));
    }
    if (a?.currentUser || Date.now() > deadline) clearInterval(iv);
  }, 200);
})();
