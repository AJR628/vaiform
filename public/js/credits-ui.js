// Minimal shared credits UI for pages that show logged-in/logged-out + credits
import { auth, db, ensureUserDoc, provider } from "./firebaseClient.js";
import { onIdTokenChanged, onAuthStateChanged, signInWithPopup, signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { doc, onSnapshot } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const loginBtn       = document.getElementById("login-button");
const logoutBtn      = document.getElementById("logout-button");
const creditDisplay  = document.getElementById("credit-display");
const creditCount    = document.getElementById("credit-count");

function toggleAuthClasses(loggedIn) {
  document.querySelectorAll(".logged-in")?.forEach(el => el.classList.toggle("hidden", !loggedIn));
  document.querySelectorAll(".logged-out")?.forEach(el => el.classList.toggle("hidden", loggedIn));
}

function updateCreditUI(n = 0) {
  if (creditDisplay) creditDisplay.classList.remove("hidden");
  if (creditCount) creditCount.textContent = String(Number.isFinite(n) ? n : 0);
}

let firestoreUnsubscribe = null;

function setupFirestoreListener(user) {
  // Clean up previous listener
  if (firestoreUnsubscribe) {
    firestoreUnsubscribe();
  }
  
  const userRef = doc(db, 'users', user.uid);
  
  // Real-time listener for user data changes
  firestoreUnsubscribe = onSnapshot(userRef, (snap) => {
    if (!snap.exists()) return;
    
    const userData = snap.data();
    const credits = Number(userData.credits ?? 0);
    updateCreditUI(credits);
    console.log('[credits-ui] user credits:', credits);
  }, (error) => {
    console.error('[credits-ui] Firestore listener error:', error);
  });
}

loginBtn?.addEventListener("click", async () => {
  try { await signInWithPopup(auth, provider); } catch (e) { console.warn("Login failed:", e); }
});
logoutBtn?.addEventListener("click", async () => {
  try { await signOut(auth); } catch (e) { console.warn("Logout failed:", e); }
});
// Keep token provider hot and update credits quickly after login/refresh
onIdTokenChanged(auth, async (u) => {
  if (u) {
    // If the api helper is present, this short wait ensures token is ready
    if (window.__vaiform_diag__?.tokenWait) { try { await window.__vaiform_diag__.tokenWait(2500); } catch {} }
  }
});

onAuthStateChanged(auth, async (u) => {
  const loggedIn = !!u;
  toggleAuthClasses(loggedIn);
  if (loggedIn) {
    await ensureUserDoc(u); // Ensure user doc exists
    setupFirestoreListener(u); // Setup real-time listener
  } else {
    // Clean up listener when logged out
    if (firestoreUnsubscribe) {
      firestoreUnsubscribe();
      firestoreUnsubscribe = null;
    }
    updateCreditUI(0);
  }
});
