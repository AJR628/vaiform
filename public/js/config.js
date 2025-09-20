// js/config.js
import { initializeApp, getApps } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, GoogleAuthProvider } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// ====== CONFIG ======
export const firebaseConfig = {
  apiKey: "AIzaSyBg9bqtZoTkC3vfEXk0vzLJAITibXfjvSY",
  authDomain: "vaiform.firebaseapp.com",
  projectId: "vaiform",
  storageBucket: "vaiform.appspot.com",
  messagingSenderId: "798543382244",
  appId: "1:798543382244:web:a826ce7ed8bebbe0b9cef1",
  measurementId: "G-971DTZ5PEN"
};

// Pull canonical BACKEND and compute our own base, so we don't rely on API_ROOT here.
import { BACKEND } from "../config.js";
export const BACKEND_URL = BACKEND.replace(/\/$/, "") + "/api";
export const BASE_URL    = BACKEND_URL;
if (typeof window !== "undefined") {
  window.BACKEND_URL = BACKEND_URL;
  window.BASE_URL    = BASE_URL;
}
// === Compatibility exports for modules expecting these ===
export const API_ROOT = BACKEND_URL;
export { BACKEND };

export const FRONTEND_URL = "https://vaiform.com";
export const UPSCALE_COST = 10;

// ====== INIT ====== 
// ✅ Prevent duplicate Firebase initialization
const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
export const provider = new GoogleAuthProvider();