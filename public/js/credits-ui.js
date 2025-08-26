// Minimal shared credits UI for pages that show logged-in/logged-out + credits
import { auth, provider } from "./config.js";
import { onIdTokenChanged, onAuthStateChanged, signInWithPopup, signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { apiFetch } from "../api.mjs";

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

async function refreshCredits() {
  try {
    const data = await apiFetch("/credits", { method: "GET" });
    const credits = Number(data?.credits ?? 0);
    updateCreditUI(Number.isNaN(credits) ? 0 : credits);
  } catch (e) {
    console.warn("[credits-ui] refreshCredits failed:", e);
  }
}

loginBtn?.addEventListener("click", async () => {
  try { await signInWithPopup(auth, provider); } catch (e) { console.warn("Login failed:", e); }
});
logoutBtn?.addEventListener("click", async () => {
  try { await signOut(auth); } catch (e) { console.warn("Logout failed:", e); }
});
creditDisplay?.addEventListener("click", () => refreshCredits());

// Keep token provider hot and update credits quickly after login/refresh
onIdTokenChanged(auth, async (u) => {
  if (u) {
    // If the api helper is present, this short wait ensures token is ready
    if (window.__vaiform_diag__?.tokenWait) { try { await window.__vaiform_diag__.tokenWait(2500); } catch {} }
    await refreshCredits();
  }
});

onAuthStateChanged(auth, async (u) => {
  const loggedIn = !!u;
  toggleAuthClasses(loggedIn);
  if (loggedIn) {
    // Make sure we show something even if /credits is slow
    updateCreditUI(0);
    await refreshCredits();
  } else {
    updateCreditUI(0);
  }
});

export { refreshCredits };
