// /public/js/my-images.js
// Read-only Firestore usage; all writes happen on the server.
// Upscale hits /generate/upscale and then we re-render the gallery.

import { auth, db } from "./firebaseClient.js";
// Import constants without Firebase initialization
const BACKEND_URL = "https://17e0d1d1-e327-483d-b1ea-c41bea08fb59-00-1ef93t84nlhq6.janeway.replit.dev/api";
const UPSCALE_COST = 10;
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  collection, query, orderBy, getDocs
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { apiFetch, setTokenProvider } from "../api.mjs";

/* ========== DOM ========== */
const gallery             = document.getElementById("gallery");
const toastEl             = document.getElementById("toast");
const downloadSelectedBtn = document.getElementById("download-selected");
const modal               = document.getElementById("image-modal");
const modalImg            = document.getElementById("modal-img");
const modalClose          = document.getElementById("modal-close");
const modalPrev           = document.getElementById("modal-prev");
const modalNext           = document.getElementById("modal-next");

// header controls (present on this page)
const loginBtn  = document.getElementById("login-button");
const logoutBtn = document.getElementById("logout-button");
const creditDisplay = document.getElementById("credit-display");
const creditCount   = document.getElementById("credit-count");

// Enforce auth-visibility classes via JS (belt & suspenders)
loginBtn?.classList.add("logged-out");
logoutBtn?.classList.add("logged-in");
creditDisplay?.classList.add("logged-in");

// Click to refresh credits
creditDisplay?.setAttribute("title", "Click to refresh credits");
creditDisplay?.addEventListener("click", () => refreshCredits(true));

/* ========== STATE ========== */
let currentUserEmail = null;
let currentUserUid   = null;
let selectedImages   = [];
let galleryFlat      = []; // flat list of { url, upscaled }
let currentIndex     = -1;

function openModalAt(index) {
  if (!Array.isArray(galleryFlat) || index < 0 || index >= galleryFlat.length) return;
  currentIndex = index;
  const item = galleryFlat[currentIndex];
  modalImg.src = item.upscaled || item.url;
  modal.classList.remove("hidden");
}

function closeModal() {
  modal.classList.add("hidden");
  currentIndex = -1;
}

function showPrev() {
  if (currentIndex <= 0) return;
  openModalAt(currentIndex - 1);
}

function showNext() {
  if (currentIndex < 0 || currentIndex >= galleryFlat.length - 1) return;
  openModalAt(currentIndex + 1);
}

modalClose?.addEventListener("click", (e) => { e.stopPropagation(); closeModal(); });
modalPrev?.addEventListener("click", (e) => { e.stopPropagation(); showPrev(); });
modalNext?.addEventListener("click", (e) => { e.stopPropagation(); showNext(); });

// Keep backdrop click to close
modal?.addEventListener("click", () => closeModal());
// Prevent click on image from closing (so users can double-tap zoom naturally later if desired)
modalImg?.addEventListener("click", (e) => e.stopPropagation());

document.addEventListener("keydown", (e) => {
  if (modal.classList.contains("hidden")) return;
  if (e.key === "Escape") return closeModal();
  if (e.key === "ArrowLeft") return showPrev();
  if (e.key === "ArrowRight") return showNext();
});

// Basic touch/swipe support
(function enableSwipe(){
  let startX = 0, startY = 0, tracking = false;
  const threshold = 40; // pixels
  modal?.addEventListener("touchstart", (e) => {
    const t = e.touches?.[0];
    if (!t) return;
    tracking = true;
    startX = t.clientX; startY = t.clientY;
  }, { passive: true });
  modal?.addEventListener("touchmove", () => {}, { passive: true });
  modal?.addEventListener("touchend", (e) => {
    if (!tracking) return;
    tracking = false;
    const t = e.changedTouches?.[0];
    if (!t) return;
    const dx = t.clientX - startX;
    const dy = t.clientY - startY;
    if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > threshold) {
      if (dx > 0) showPrev(); else showNext();
    }
  });
})();

/* ========== HELPERS ========== */
function showToast(msg, ms = 2200) {
  if (!toastEl) return;
  toastEl.textContent = msg;
  toastEl.classList.remove("hidden");
  setTimeout(() => toastEl.classList.add("hidden"), ms);
}

async function getIdToken() {
  const u = auth.currentUser;
  if (!u) throw new Error("Please log in first.");
  return u.getIdToken();
}

function updateCreditUI(n) {
  creditDisplay?.classList.remove("hidden");
  if (creditCount) creditCount.textContent = String(typeof n === "number" ? n : 0);
}

async function refreshCredits(force = true, retries = 1) {
  if (!auth.currentUser) { updateCreditUI(0); return; }
  try {
    const data = await apiFetch("/credits");
    const credits = Number(data?.credits ?? 0);
    updateCreditUI(Number.isNaN(credits) ? 0 : credits);
  } catch (err) {
    if (retries > 0) return refreshCredits(false, retries - 1);
    showToast("Couldn't load credits. Try again in a moment.");
    console.warn("Credits fetch failed:", err);
  }
}

/* ========== RENDER ========== */
function makeTile({ url, upscaledUrl, genId, index }) {
  const flatIndex = galleryFlat.length;
  galleryFlat.push({ url, upscaled: upscaledUrl || null });
  const wrap = document.createElement("div");
  wrap.className = "relative group rounded overflow-hidden shadow hover:shadow-lg transition";

  const img = document.createElement("img");
  img.src = url;
  img.alt = "AI image";
  img.loading = "lazy";
  img.className = "w-full h-auto object-cover cursor-pointer";
  img.addEventListener("click", () => openModalAt(flatIndex));

  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.className = "absolute top-1 left-1 w-4 h-4 bg-white rounded z-10 cursor-pointer";
  checkbox.addEventListener("click", (e) => {
    e.stopPropagation();
    const chosen = upscaledUrl || url;
    if (checkbox.checked) selectedImages.push(chosen);
    else selectedImages = selectedImages.filter(u => u !== chosen);
    if (downloadSelectedBtn) {
      downloadSelectedBtn.classList.toggle("hidden", selectedImages.length === 0);
    }
  });

  const bar = document.createElement("div");
  bar.className = "absolute bottom-1 right-1 flex gap-2 opacity-0 group-hover:opacity-100 transition";

  // Download
  const dlBtn = document.createElement("button");
  dlBtn.textContent = "⬇";
  dlBtn.title = "Download";
  dlBtn.className = "bg-indigo-600 text-white px-2 py-1 rounded text-xs hover:bg-indigo-700";
  dlBtn.onclick = (e) => {
    e.stopPropagation();
    const a = document.createElement("a");
    a.href = upscaledUrl || url;
    a.download = `vaiform-image-${index + 1}.png`;
    a.click();
  };

  // Delete (server-side only; client is read-only)
  const delBtn = document.createElement("button");
  delBtn.textContent = "🗑";
  delBtn.title = "Delete this set";
  delBtn.className = "bg-red-600 text-white px-2 py-1 rounded text-xs hover:bg-red-700";
  delBtn.onclick = (e) => {
    e.stopPropagation();
    showToast("Server-side delete coming soon.");
  };

  // Upscale / View
  const action = document.createElement(upscaledUrl ? "a" : "button");
  if (upscaledUrl) {
    action.href = upscaledUrl;
    action.target = "_blank";
    action.rel = "noopener";
    action.textContent = "View Upscaled";
    action.className = "text-sm px-3 py-1 rounded bg-green-600 hover:bg-green-700 text-white";
  } else {
    action.type = "button";
    action.textContent = `Upscale (${UPSCALE_COST} credits)`;
    action.className = "text-sm px-3 py-1 rounded bg-indigo-600 hover:bg-indigo-700 text-white";
    action.onclick = async (e) => {
      e.stopPropagation();
      action.disabled = true;
      const old = action.textContent;
      action.textContent = "Upscaling…";
      try {
        await apiFetch("/generate/upscale", {
          method: "POST",
          body: { imageUrl: url }
        });
        // Backend writes Firestore; just refresh UI
        if (typeof renderGallery === "function") {
          await renderGallery(currentUserUid);
        } else {
          window.location.reload();
        }
        showToast("✅ Upscaled!");
        await refreshCredits();
      } catch (err) {
        console.error(err);
        action.textContent = old;
        showToast(err.message || "Upscale failed");
      } finally {
        action.disabled = false;
      }
    };
  }

  bar.appendChild(dlBtn);
  bar.appendChild(delBtn);
  bar.appendChild(action);

  wrap.appendChild(img);
  wrap.appendChild(checkbox);
  wrap.appendChild(bar);
  return wrap;
}

function normalizeItems(data) {
  // Support multiple schemas for back-compat:
  // - artifacts: [{ i, url }]
  // - items:     [{ original, upscaled? }]
  // - urls:      [string] with optional upscaled map
  if (Array.isArray(data?.artifacts)) {
    return data.artifacts.map(a => ({
      original: a.url,
      upscaled: a.upscaled || null
    }));
  }
  if (Array.isArray(data?.items)) {
    return data.items.map(it => ({
      original: it.original,
      upscaled: it.upscaled || null
    }));
  }
  if (Array.isArray(data?.urls)) {
    return data.urls.map(u => ({
      original: u,
      upscaled: data.upscaled?.[u] || null
    }));
  }
  return [];
}

async function renderGallery(uid) {
  const subCol = collection(db, "users", uid, "generations"); // UID path
  const q = query(subCol, orderBy("createdAt", "desc"));
  const snap = await getDocs(q);

  if (snap.empty) {
    gallery.innerHTML = "No images found yet.";
    selectedImages = [];
    downloadSelectedBtn?.classList.add("hidden");
    return;
  }

  gallery.innerHTML = "";
  selectedImages = [];
  downloadSelectedBtn?.classList.add("hidden");

  snap.forEach((docSnap) => {
    const genId = docSnap.id;
    const raw   = docSnap.data();
    const when  = (raw?.createdAt?.toDate?.() ?? new Date(0)); // safe Timestamp → Date
    const items = normalizeItems(raw);

    items.forEach((it, index) => {
      const tile = makeTile({
        url: it.original,
        upscaledUrl: it.upscaled || null,
        genId,
        index
      });
      // (Optional) attach a data-title/tooltip with createdAt/prompt
      tile.title = `${when.toLocaleString()} — ${raw?.prompt || ""}`.trim();
      gallery.appendChild(tile);
    });
  });
}

/* ========== DOWNLOAD SELECTED ========== */
downloadSelectedBtn?.addEventListener("click", () => {
  selectedImages.forEach((url, i) => {
    const a = document.createElement("a");
    a.href = url;
    a.download = `vaiform-image-${i + 1}.png`;
    a.click();
  });
});

/* ========== MODAL ========== */


/* ========== AUTH + Header state ========== */
onAuthStateChanged(auth, async (user) => {
  const loggedIn = !!user;
  document.querySelectorAll(".logged-in")?.forEach(el => el.classList.toggle("hidden", !loggedIn));
  document.querySelectorAll(".logged-out")?.forEach(el => el.classList.toggle("hidden", loggedIn));

  if (!loggedIn) {
    currentUserEmail = null;
    currentUserUid = null;
    if (gallery) gallery.innerHTML = "Please sign in on the homepage to view your images.";
    updateCreditUI(0);
    return;
  }

  currentUserEmail = user.email || null;
  currentUserUid   = user.uid;

  try {
    await refreshCredits();           // show UID credits in header
    await renderGallery(currentUserUid); // load images from UID path
  } catch (e) {
    console.error(e);
    showToast("Failed to load gallery.");
  }
});

// Token provider for this page too (safe if called twice)
try {
  setTokenProvider(async () => {
    const u = (window.auth?.currentUser) || (window.firebase?.auth?.().currentUser);
    return u?.getIdToken ? u.getIdToken() : null;
  });
} catch {}

/* ========== PENDING TILES (Async Pixar) ========== */
(function pendingTiles(){
  const grid = document.querySelector("#gallery") || document.querySelector(".gallery") || document.body;

  function renderPlaceholder(jobId) {
    const existing = document.querySelector(`[data-pending-id="${jobId}"]`);
    if (existing) return existing;
    const card = document.createElement("div");
    card.className = "card generating";
    card.dataset.pendingId = jobId;
    card.innerHTML = `
      <div class="skeleton"></div>
      <div class="meta">
        <strong>Your 3D image is being created!</strong>
        <div class="sub">This can take a couple of minutes.</div>
        <div class="spinner"></div>
      </div>
    `;
    grid.prepend(card);
    return card;
  }

  async function check(jobId){
    try {
      const res = await apiFetch(`/job/${encodeURIComponent(jobId)}`);
      if (!res?.data) return { code: 'NOT_FOUND' };
      return { code: 'OK', data: res.data };
    } catch (e) {
      return { code: 'ERROR', error: String(e?.message || e) };
    }
  }

  async function poll(jobId){
    const card = document.querySelector(`[data-pending-id="${jobId}"]`);
    if (!card) return;
    card._t0 = card._t0 || Date.now();

    const r = await check(jobId);
    if (r.code === 'OK') {
      const { status, images, artifacts, error } = r.data || {};
      const list = Array.isArray(images) ? images : (Array.isArray(artifacts) ? artifacts : []);
      const statusEl = card.querySelector('.meta');
      if (statusEl) {
        statusEl.querySelector?.('.status')?.remove?.();
        const s = document.createElement('div');
        s.className = 'status';
        s.textContent = status || 'processing';
        statusEl.appendChild(s);
      }

      if ((status === 'complete' || status === 'completed') && list.length > 0) {
        // Done: remove placeholder and let gallery refresh show it
        card.remove();
        sessionStorage.removeItem(`pending:${jobId}`);
        try { await renderGallery(currentUserUid); } catch {}
        return;
      }

      // Keep waiting politely
      setTimeout(() => poll(jobId), 2500);
      return;
    }

    if (r.code === 'NOT_FOUND') {
      // Early 404 → queued/propagating
      if (Date.now() - (card._t0 || 0) < 10000) {
        setTimeout(() => poll(jobId), 3000);
        return;
      }
      setTimeout(() => poll(jobId), 5000);
      return;
    }

    // Generic network/auth error: back off and retry
    setTimeout(() => poll(jobId), 4000);
  }

  async function tick(){
    const keys = Object.keys(sessionStorage).filter(k => k.startsWith("pending:"));
    if (keys.length === 0) return;
    for (const k of keys) {
      const { jobId } = JSON.parse(sessionStorage.getItem(k) || "{}");
      if (!jobId) { sessionStorage.removeItem(k); continue; }
      renderPlaceholder(jobId);
      poll(jobId);
    }
  }

  // poll every 5s; stop after ~10 minutes to be safe
  let runs = 0;
  const iv = setInterval(async () => {
    runs++;
    await tick();
    if (runs > 120) clearInterval(iv);
  }, 5000);

  // render immediately once
  tick();
})();