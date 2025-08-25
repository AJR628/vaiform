// /public/js/my-images.js
// Read-only Firestore usage; all writes happen on the server.
// Upscale hits /generate/upscale and then we re-render the gallery.

import { auth, db, BACKEND_URL, UPSCALE_COST } from "./config.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  collection, query, orderBy, getDocs
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { apiFetch } from "../api.js";

/* ========== DOM ========== */
const gallery             = document.getElementById("gallery");
const toastEl             = document.getElementById("toast");
const downloadSelectedBtn = document.getElementById("download-selected");
const modal               = document.getElementById("image-modal");
const modalImg            = document.getElementById("modal-img");

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
  const wrap = document.createElement("div");
  wrap.className = "relative group rounded overflow-hidden shadow hover:shadow-lg transition";

  const img = document.createElement("img");
  img.src = url;
  img.alt = "AI image";
  img.loading = "lazy";
  img.className = "w-full h-auto object-cover cursor-pointer";
  img.addEventListener("click", () => {
    if (!modal || !modalImg) return;
    modalImg.src = upscaledUrl || url;
    modal.classList.remove("hidden");
  });

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
modal?.addEventListener("click", () => modal.classList.add("hidden"));
document.addEventListener("keydown", (e) => { if (e.key === "Escape") modal?.classList.add("hidden"); });

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
