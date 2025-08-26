// Bridge Firebase auth → api.js token provider (works with compat or when window.auth is present)
import { setTokenProvider } from "./api.mjs";
import { auth } from "./js/config.js";
import { onIdTokenChanged, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

// Expose the modular auth instance for any legacy code expecting window.auth
try { if (!window.auth) window.auth = auth; } catch {}

// 1) Provide a token immediately if possible
setTokenProvider(async () => {
  const u = auth.currentUser;
  return u?.getIdToken ? u.getIdToken() : null;
});

// 2) Update provider whenever Firebase rotates/refreshes the ID token
onIdTokenChanged(auth, (u) => {
  setTokenProvider(async () => (u?.getIdToken ? u.getIdToken() : null));
});

// 3) Also react to login/logout
onAuthStateChanged(auth, (u) => {
  setTokenProvider(async () => (u?.getIdToken ? u.getIdToken() : null));
});
