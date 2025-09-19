// public/js/pricingAuthHandlers.js
import { auth, ensureUserDoc, db } from "/js/firebaseClient.js";
import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  GoogleAuthProvider, 
  signInWithPopup
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

export async function uiSignIn(email, password) {
  try {
    const { user } = await signInWithEmailAndPassword(auth, email, password);
    await ensureUserDoc(user);
    return user;
  } catch (error) {
    throw new Error(`Sign in failed: ${error.message}`);
  }
}

export async function uiSignUp(email, password) {
  try {
    const { user } = await createUserWithEmailAndPassword(auth, email, password);
    await ensureUserDoc(user);
    return user;
  } catch (error) {
    throw new Error(`Sign up failed: ${error.message}`);
  }
}

export async function uiGoogle() {
  try {
    const provider = new GoogleAuthProvider();
    const { user } = await signInWithPopup(auth, provider);
    await ensureUserDoc(user);
    return user;
  } catch (error) {
    throw new Error(`Google sign in failed: ${error.message}`);
  }
}

export async function routeAfterAuth(user) {
  try {
    const snap = await getDoc(doc(db, "users", user.uid));
    const userData = snap.data() || {};
    
    if (userData.isMember) {
      window.location.href = "/creative";
    } else {
      window.location.href = "/pricing";
    }
  } catch (error) {
    console.error("Error routing after auth:", error);
    // Fallback to pricing page
    window.location.href = "/pricing";
  }
}
