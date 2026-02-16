// /js/buy-credits.js
import { auth, provider } from "./firebaseClient.js";
const BACKEND_URL = "https://17e0d1d1-e327-483d-b1ea-c41bea08fb59-00-1ef93t84nlhq6.janeway.replit.dev/api";
import { onAuthStateChanged, signInWithPopup } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { apiFetch } from "../api.mjs";
const toastEl = document.getElementById("toast");
const modeOnetime = document.getElementById("mode-onetime");
const modeMonthly = document.getElementById("mode-monthly");
const billingNote = document.getElementById("billing-note");
const refundNote  = document.getElementById("refund-note");
const cards = Array.from(document.querySelectorAll(".bundle-card"));
const manageBtn = document.getElementById("manage-billing");

let mode = "onetime";

function toast(msg) {
  if (!toastEl) return alert(msg);
  toastEl.textContent = msg;
  toastEl.classList.remove("hidden");
  setTimeout(() => toastEl.classList.add("hidden"), 2200);
}

async function ensureAuth() {
  const u = auth.currentUser || await new Promise((resolve) => {
    const off = onAuthStateChanged(auth, (user) => { off(); resolve(user); });
  });
  if (u) return u;
  try {
    await signInWithPopup(auth, provider);
    return auth.currentUser;
  } catch {
    return null;
  }
}

async function startOneTime({ priceId, credits = 0, quantity = 1 }) {
  const user = await ensureAuth();
  if (!user) return toast("Please sign in to buy credits.");

  const data = await apiFetch("/session", {
    method: "POST",
    body: { priceId, quantity, credits } // credits optional (for analytics/metadata)
  });
  if (!data?.url) return toast(data?.error || "Checkout failed");
  window.location = data.url;
}

async function startSubscription({ priceId, credits = 0 }) {
  const user = await ensureAuth();
  if (!user) return toast("Please sign in to subscribe.");

  const data = await apiFetch("/subscription", {
    method: "POST",
    body: { priceId, credits } // credits optional (for analytics/metadata)
  });
  if (!data?.url) return toast(data?.error || "Subscription checkout failed");
  window.location = data.url;
}

function applyMode(newMode) {
  mode = newMode;

  const setBtn = (el, active) => {
    el?.classList.toggle("bg-white", active);
    el?.classList.toggle("text-indigo-700", active);
    el?.classList.toggle("text-white", !active);
    el?.classList.toggle("hover:bg-white/20", !active);
  };
  setBtn(modeOnetime, mode === "onetime");
  setBtn(modeMonthly, mode === "monthly");

  if (billingNote) {
    billingNote.textContent = mode === "onetime"
      ? "One-time purchases. Credit refunds only for failed generations."
      : "Monthly subscriptions renew automatically. Cancel anytime.";
  }
  if (refundNote) {
    refundNote.textContent = mode === "onetime"
      ? "Credits are final; refunds only for failed generations."
      : "Subscriptions renew monthly; contact support for billing issues.";
  }

  // Update price label and button text on each card (visual only)
  cards.forEach((card) => {
    const priceText = card.dataset[mode === "onetime" ? "priceOnetime" : "priceMonthly"] || "";
    const priceEl = card.querySelector(".price");
    const btn = card.querySelector(".buy-btn");
    if (priceEl) priceEl.textContent = priceText;
    if (btn) btn.textContent = mode === "onetime" ? "Buy Now" : "Subscribe";
  });
}

// Attach click handlers (reads data-* set in your HTML)
cards.forEach((card) => {
  const btn = card.querySelector(".buy-btn");
  if (!btn) return;

  btn.addEventListener("click", () => {
    const credits = Number(card.dataset.credits || 0);
    if (mode === "onetime") {
      const priceId = card.dataset.priceIdOnetime;
      if (!priceId || priceId.includes("REPLACE")) return toast("Price ID not set for this bundle.");
      startOneTime({ priceId, credits, quantity: 1 });
    } else {
      const priceId = card.dataset.priceIdMonthly;
      if (!priceId || priceId.includes("REPLACE")) return toast("Subscription price ID not set for this bundle.");
      startSubscription({ priceId, credits });
    }
  });
});

// Manage Billing (Stripe Billing Portal)
manageBtn?.addEventListener("click", async () => {
  // Button UX
  const old = manageBtn.textContent;
  manageBtn.disabled = true;
  manageBtn.textContent = "Opening…";

  try {
    const user = await ensureAuth();
    if (!user) { toast("Please sign in to manage billing."); return; }

    const data = await apiFetch("/portal", {
      method: "POST"
    });
    if (!data?.url) return toast(data?.error || "Could not open billing portal");
    window.location = data.url;
  } catch (e) {
    console.error(e);
    toast("Something went wrong opening the billing portal.");
  } finally {
    manageBtn.disabled = false;
    manageBtn.textContent = old;
  }
});

// Init onetime by default
applyMode("onetime");
modeOnetime?.addEventListener("click", () => applyMode("onetime"));
modeMonthly?.addEventListener("click", () => applyMode("monthly"));

// Optional: propagate success/cancel messages onto a toast
(function () {
  const qp = new URLSearchParams(location.search);
  if (qp.get("success") === "1") sessionStorage.setItem("vaiform_toast", "✅ Payment succeeded — credits added!");
  if (qp.get("canceled") === "1") sessionStorage.setItem("vaiform_toast", "Payment canceled.");
})();
