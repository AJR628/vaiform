// public/js/firebaseClient.js
import { initializeApp, getApps } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, GoogleAuthProvider } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// ✅ Firebase Web SDK config (from console) - using EXACT same config as working config.js
const firebaseConfig = {
  apiKey: "AIzaSyBg9bqtZoTkC3vfEXk0vzLJAITibXfjvSY",  // Fixed: was missing 'I' character
  authDomain: "vaiform.firebaseapp.com",
  projectId: "vaiform",
  storageBucket: "vaiform.appspot.com",   // <-- must be appspot for browser
  messagingSenderId: "798543382244",
  appId: "1:798543382244:web:a826ce7ed8bebbe0b9cef1",
  measurementId: "G-971DTZ5PEN"
};

const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
export const provider = new GoogleAuthProvider();

// initialize user profile for every new login/signup - calls server-side /api/users/ensure
export async function ensureUserDoc(user) {
  if (!user || !user.uid) return;
  
  try {
    // Call server-side endpoint instead of direct Firestore writes
    const { apiFetch } = await import("../api.mjs");
    const resp = await apiFetch("/users/ensure", {
      method: "POST"
    });

    if (resp.success) {
      console.log(`[firebaseClient] User doc ensured via API: ${user.uid} (${user.email})`);
    } else {
      console.warn(`[firebaseClient] Failed to ensure user doc via API:`, resp.error || resp.detail);
    }
  } catch (error) {
    // Log warning but don't throw - page should still work if this fails
    console.warn("[firebaseClient] Failed to ensure user doc:", error?.message || error);
  }
}
