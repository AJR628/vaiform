// Bridge Firebase auth → api.js token provider (works with compat or when window.auth is present)
import { setTokenProvider } from "./api.mjs";
import { auth, db, ensureUserDoc } from "./js/firebaseClient.js";
import { onIdTokenChanged, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

// Expose the modular auth instance for any legacy code expecting window.auth
try { if (!window.auth) window.auth = auth; } catch {}
try { if (!window.db) window.db = db; } catch {}
try { if (!window.onAuthStateChanged) window.onAuthStateChanged = onAuthStateChanged; } catch {}

// Track if we've already called ensureUserDoc for this user to avoid duplicate calls
let ensuredUid = null;

// 1) Provide a token immediately if possible
setTokenProvider(async () => {
  const u = auth.currentUser;
  return u?.getIdToken ? u.getIdToken() : null;
});

// 2) Update provider whenever Firebase rotates/refreshes the ID token
onIdTokenChanged(auth, (u) => {
  setTokenProvider(async () => (u?.getIdToken ? u.getIdToken() : null));
});

// 3) Also react to login/logout - ensure user doc on first login
onAuthStateChanged(auth, async (u) => {
  setTokenProvider(async () => (u?.getIdToken ? u.getIdToken() : null));
  
  // Ensure user doc exists on server-side when user logs in (once per session)
  if (u?.uid && ensuredUid !== u.uid) {
    ensuredUid = u.uid;
    // Call ensureUserDoc which now uses /api/users/ensure
    await ensureUserDoc(u);
  } else if (!u) {
    // Reset on logout
    ensuredUid = null;
  }
});
