// public/js/firebaseClient.js
import { initializeApp, getApps } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, GoogleAuthProvider } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirestore, doc, setDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

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

// initialize Free profile for every new login/signup
export async function ensureUserDoc(user) {
  if (!user || !user.uid) return;
  
  try {
    const ref = doc(db, "users", user.uid);
    await setDoc(ref, {
      email: user.email || null,
      plan: "free",
      isMember: false,
      credits: 0,
      shortDayKey: new Date().toISOString().slice(0, 10),
      shortCountToday: 0,
      membership: { 
        kind: null, 
        expiresAt: null, 
        nextPaymentAt: null 
      },
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    }, { merge: true });
    
    console.log(`[firebaseClient] User doc ensured: ${user.uid} (${user.email})`);
  } catch (error) {
    console.error("Failed to ensure user doc:", error);
  }
}
