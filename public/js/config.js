// js/config.js
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
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
};

// Re-export the single source of truth and keep compat symbols.
export { BACKEND, API_ROOT } from "../config.js";
export const BACKEND_URL = API_ROOT;  // compat: many pages expect this
export const BASE_URL    = API_ROOT;  // compat: many pages expect this
if (typeof window !== "undefined") {
  window.BACKEND_URL = BACKEND_URL;
  window.BASE_URL    = BASE_URL;
}

export const FRONTEND_URL = "https://vaiform.com";
export const UPSCALE_COST = 10;

// ====== INIT ======
const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
export const provider = new GoogleAuthProvider();