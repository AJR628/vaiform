// /frontend.js
import { auth, db, provider, BACKEND_URL, UPSCALE_COST } from "./js/config.js";
import { signInWithPopup, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { doc, getDoc, setDoc, updateDoc, serverTimestamp, increment } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { apiFetch, setTokenProvider } from "./api.mjs";

/* ========================= DEV HELPERS ========================= */
// Wait until Firebase auth knows our user (once)
async function awaitAuthReadyOnce() {
  if (auth.currentUser != null) return;
  await new Promise((resolve) => {
    const off = onAuthStateChanged(auth, () => { off(); resolve(); });
  });
}

// Handy: get & copy a fresh Firebase ID token
window.getIdTokenDebug = async (forceRefresh = true) => {
  await awaitAuthReadyOnce();
  const u = auth.currentUser;
  if (!u) { console.warn("⚠️ No user signed in"); return null; }
  const t = await u.getIdToken(forceRefresh);
  try { await navigator.clipboard.writeText(t); console.log("✅ ID token copied to clipboard"); }
  catch { console.log("🔑 ID token:", t); }
  return t;
};

/* ========================= DOM ========================= */
const loginBtn = document.getElementById("login-button");
const logoutBtn = document.getElementById("logout-button");
const creditDisplay = document.getElementById("credit-display");
const creditCount = document.getElementById("credit-count");
const themeToggle = document.getElementById("theme-toggle");

const promptInput = document.getElementById("prompt");
const enhanceBtn = document.getElementById("enhance-button");
const enhanceSpinner = document.getElementById("enhance-spinner");

const generateForm = document.getElementById("generate-form");
const generateButton = document.getElementById("generate-button");
const loadingSpinner = document.getElementById("loading-spinner");

const styleSelect = document.getElementById("style");
const numImagesSelect = document.getElementById("numImages");
const upscaleToggle = document.getElementById("upscale-toggle");

const guidanceInput = document.getElementById("guidance");
const stepsInput = document.getElementById("steps");
const seedInput = document.getElementById("seed");
const schedulerInput = document.getElementById("scheduler");
const refinerInput = document.getElementById("refiner");

const dropZone = document.getElementById("dropZone");
const fileInput = document.getElementById("referenceImage");
const referencePreview = document.getElementById("referencePreview");
const removeImageBtn = document.getElementById("removeImageBtn");
const styleHelper = document.getElementById("style-helper");
const generationMode = document.getElementById("generationMode");
const imageToggleWrapper = document.getElementById("imageToggleWrapper");
const imageModeToggle = document.getElementById("imageModeToggle");
const emailHidden = document.getElementById("email");
const toastEl = document.getElementById("toast");

// Enforce auth-visibility classes via JS (belt & suspenders)
loginBtn?.classList.add("logged-out");
logoutBtn?.classList.add("logged-in");
creditDisplay?.classList.add("logged-in");

// Click to refresh credits
creditDisplay?.setAttribute("title", "Click to refresh credits");
creditDisplay?.addEventListener("click", () => refreshCredits(true));

/* ========================= STATE ========================= */
let currentUserEmail = null;
let currentCredits = 0;
let uploadedImageBase64 = ""; // we store a Data URL here (image/webp)
let enhancingBusy = false;

/* ========================= UI HELPERS ========================= */
const showToast = (msg, ms = 2200) => {
  if (!toastEl) return;
  toastEl.textContent = msg;
  toastEl.classList.remove("hidden");
  setTimeout(() => toastEl.classList.add("hidden"), ms);
};

const updateCreditUI = (credits) => {
  currentCredits = typeof credits === "number" ? credits : 0;
  creditDisplay?.classList.remove("hidden");
  if (creditCount) creditCount.textContent = String(currentCredits);
};

/* ========================= AUTH ========================= */
async function getIdToken(forceRefresh = false) {
  if (!auth.currentUser) {
    await new Promise((resolve) => {
      const unsub = onAuthStateChanged(auth, () => { unsub(); resolve(); });
    });
  }
  const u = auth.currentUser;
  if (!u) throw new Error("Please sign in first.");
  return u.getIdToken(forceRefresh);
}



/* ========================= CREDITS ========================= */
async function refreshCredits(force = true, retries = 1) {
  if (!auth.currentUser) { updateCreditUI(0); return; }
  try {
    const data = await apiFetch("/credits", { method: "GET" });
    const credits = Number(data?.credits ?? 0);
    updateCreditUI(Number.isNaN(credits) ? 0 : credits);
  } catch (err) {
    if (retries > 0) return refreshCredits(false, retries - 1);
    showToast("Couldn't load credits. Try again in a moment.");
    console.warn("Credits fetch failed:", err);
  }
}

const computeGenCost = (n) => (n === 1 ? 20 : n === 2 ? 40 : 70);

// Treat both "pixar" and "pixar-3d" as img2img style
const isPixarish = (style) => style === "pixar" || style === "pixar-3d";

// Mode indicator reflects: pixarish OR uploaded image OR user toggle
const updateModeIndicator = () => {
  const style = styleSelect?.value;
  const usingImage = isPixarish(style) || !!uploadedImageBase64 || !!imageModeToggle?.checked;
  if (generationMode) {
    generationMode.textContent = usingImage ? "🖼️ Image-to-Image" : "📝 Text-to-Image";
  }
};

// Spinner fade helpers
function showLoading() {
  if (!loadingSpinner) return;
  loadingSpinner.classList.remove("hidden");
  requestAnimationFrame(() => {
    requestAnimationFrame(() => loadingSpinner.classList.remove("opacity-0"));
  });
}
function hideLoading() {
  if (!loadingSpinner) return;
  loadingSpinner.classList.add("opacity-0");
  setTimeout(() => loadingSpinner.classList.add("hidden"), 300);
}

/* ========================= IMAGE HELPERS ========================= */
const readFileAsDataURL = (file) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });

// Downscale + re-encode to webp Data URL for transport
async function downscaleToDataURL(file, maxSide = 1536, mime = "image/webp", quality = 0.9) {
  const srcDataUrl = await readFileAsDataURL(file);
  const img = await new Promise((res, rej) => {
    const i = new Image();
    i.onload = () => res(i);
    i.onerror = rej;
    i.src = srcDataUrl;
  });
  const { width, height } = img;
  const scale = Math.min(1, maxSide / Math.max(width, height));
  const w = Math.round(width * scale);
  const h = Math.round(height * scale);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0, w, h);
  return canvas.toDataURL(mime, quality);
}

/* ========================= THEME ========================= */
themeToggle?.addEventListener("click", () => {
  const isDark = document.documentElement.classList.toggle("dark");
  localStorage.setItem("theme", isDark ? "dark" : "light");
});

/* ========================= AUTH BUTTONS ========================= */
loginBtn?.addEventListener("click", async () => {
  try { await signInWithPopup(auth, provider); }
  catch (err) { console.error("Login failed:", err); }
});

logoutBtn?.addEventListener("click", async () => {
  try { await signOut(auth); }
  catch (err) { console.error("Logout failed:", err); }
});

onAuthStateChanged(auth, async (user) => {
  const loggedIn = !!user;
  document.querySelectorAll(".logged-in")?.forEach(el => el.classList.toggle("hidden", !loggedIn));
  document.querySelectorAll(".logged-out")?.forEach(el => el.classList.toggle("hidden", loggedIn));

  if (!loggedIn) {
    currentUserEmail = null;
    creditDisplay?.classList.add("hidden");
    updateCreditUI(0);
    return;
  }

  currentUserEmail = user.email;
  if (emailHidden) emailHidden.value = currentUserEmail;

  try {
    // Give api.mjs a brief moment to obtain the token via the bridge
    if (window.__vaiform_diag__?.tokenWait) { await window.__vaiform_diag__.tokenWait(4000); }
    await refreshCredits(true); // hits /credits
  } catch (e) {
    console.error("Failed to refresh credits:", e);
  }
});

/* ========================= ENHANCE PROMPT ========================= */
enhanceBtn?.addEventListener("click", async () => {
  const original = promptInput?.value.trim();
  if (!original) return showToast("Please enter a prompt to enhance.");
  if (!auth.currentUser) return showToast("Please log in to enhance prompts.");
  if (currentCredits < 1) return showToast("Not enough credits for enhancement (1 credit).");

  if (enhancingBusy) return;
  enhancingBusy = true;

  try {
    enhanceBtn.disabled = true;
    enhanceSpinner?.classList.remove("hidden");

    const response = await apiFetch("/enhance", {
      method: "POST",
      body: { prompt: original, strength: 0.6 }
    });

    console.log("Enhance response:", response); // Debug log

    // Handle different possible response structures
    let enhancedPrompt = null;
    // prefer the current shape; keep minimal legacy fallbacks
    if (response?.data?.enhancedPrompt) {
      enhancedPrompt = response.data.enhancedPrompt;
    } else if (response?.enhancedPrompt) {
      enhancedPrompt = response.enhancedPrompt;
    } else if (response?.data?.prompt) {
      enhancedPrompt = response.data.prompt; // legacy fallback if ever used
    } else if (response?.enhanced) {
      enhancedPrompt = response.enhanced; // legacy fallback
    }

    if (enhancedPrompt) {
      promptInput.value = enhancedPrompt;
      console.log("Updated prompt to:", enhancedPrompt);
    } else {
      console.log("No enhanced prompt found in response. Response structure:", response);
      showToast("Enhancement succeeded but couldn't update prompt. Check console for details.");
    }

    await refreshCredits(false);
    showToast("✨ Prompt enhanced");
  } catch (e) {
    console.error(e);
    showToast(e.message || "Enhancement failed. Try again.");
  } finally {
    enhancingBusy = false;
    enhanceBtn.disabled = false;
    enhanceSpinner?.classList.add("hidden");
  }
});

/* ========================= IMAGE UPLOAD ========================= */
const handleFiles = async (files) => {
  if (!files || !files[0]) return;
  const file = files[0];

  const style = styleSelect?.value;
  const pixarish = isPixarish(style);
  const maxSide = pixarish ? 1024 : 1536;
  const quality = pixarish ? 0.85 : 0.9;

  let dataUrl;
  try {
    dataUrl = await downscaleToDataURL(file, maxSide, "image/webp", quality);
  } catch (err) {
    console.warn("Downscale failed, using original image:", err);
    dataUrl = await readFileAsDataURL(file);
  }

  uploadedImageBase64 = dataUrl; // store data URL

  if (referencePreview) {
    referencePreview.src = dataUrl;
    referencePreview.classList.remove("hidden");
  }
  removeImageBtn?.classList.remove("hidden");
  dropZone?.classList.add("hidden");

  if (imageModeToggle && !pixarish) {
    imageModeToggle.checked = true;
  }
  updateModeIndicator();
};

dropZone?.addEventListener("dragover", (e) => {
  e.preventDefault();
  dropZone.classList.add("border-indigo-500");
});
dropZone?.addEventListener("dragleave", () => {
  dropZone.classList.remove("border-indigo-500");
});
dropZone?.addEventListener("drop", async (e) => {
  e.preventDefault();
  dropZone.classList.remove("border-indigo-500");
  await handleFiles(e.dataTransfer.files);
});
fileInput?.addEventListener("change", async (e) => {
  await handleFiles(e.target.files);
});
removeImageBtn?.addEventListener("click", () => {
  uploadedImageBase64 = "";
  referencePreview?.classList.add("hidden");
  removeImageBtn?.classList.add("hidden");
  dropZone?.classList.remove("hidden");
  if (imageModeToggle) imageModeToggle.checked = false;
  updateModeIndicator();
});

imageModeToggle?.addEventListener("change", updateModeIndicator);

/* ========================= STYLE DEFAULTS ========================= */
function applyStyleDefaults(style) {
  const pixarish = isPixarish(style);

  if (pixarish) {
    styleHelper && (styleHelper.textContent = "Pixar mode transforms your photo into a 3D animated look. Please upload an image to continue.");
    imageToggleWrapper?.classList.add("hidden");
    imageModeToggle && (imageModeToggle.checked = true);

    if (!uploadedImageBase64) {
      dropZone?.classList.remove("hidden");
      referencePreview?.classList.add("hidden");
      removeImageBtn?.classList.add("hidden");
    }

    // Auto-prompt: when selecting Pixar and an image is attached,
    // ensure there is a sensible default prompt users can edit/replace
    if (uploadedImageBase64 && promptInput) {
      const directive = "Convert the image into a 3D animated style.";
      const current = (promptInput.value || "").trim();
      if (current.length < 3) {
        promptInput.value = directive;
      } else if (!current.toLowerCase().includes("3d animated")) {
        // keep user text, gently append the directive once
        promptInput.value = `${current} ${directive}`;
      }
    }

    guidanceInput && (guidanceInput.value = 3.0);
    stepsInput && (stepsInput.value = 28);
    schedulerInput && (schedulerInput.value = "K_EULER");
    refinerInput && (refinerInput.value = "none");
  } else {
    styleHelper && (styleHelper.textContent = "");
    imageToggleWrapper?.classList.remove("hidden");

    if (style === "realistic") {
      guidanceInput && (guidanceInput.value = 3.5);
      stepsInput && (stepsInput.value = 28);
      schedulerInput && (schedulerInput.value = "K_EULER");
      refinerInput && (refinerInput.value = "expert_ensemble_refiner");
    } else if (style === "cartoon") {
      guidanceInput && (guidanceInput.value = 4.5);
      stepsInput && (stepsInput.value = 30);
      schedulerInput && (schedulerInput.value = "K_EULER");
      refinerInput && (refinerInput.value = "none");
    }

    imageModeToggle && (imageModeToggle.checked = false);
    dropZone?.classList.remove("hidden");
  }

  updateModeIndicator();
}

styleSelect?.addEventListener("change", () => {
  applyStyleDefaults(styleSelect.value);
});

/* ========================= GENERATE ========================= */
generateForm?.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!auth.currentUser) return showToast("Please log in first.");

  // ✅ Minimal schema-aligned payload for /generate
  // Root keys allowed by backend schema: style|provider, prompt, count, options
  // When using "pixar", image must be provided as options.image_url or options.image_base64
  
  const style = styleSelect?.value;
  const pixarish = isPixarish(style);
  const wantsImageMode = pixarish || !!uploadedImageBase64 || !!imageModeToggle?.checked;

  const prompt = (promptInput?.value || "").trim();
  if (!prompt && !wantsImageMode) {
    return showToast("Please enter a prompt.");
  }

  const numImages = parseInt(numImagesSelect?.value || "1", 10);

  const needed = computeGenCost(numImages);
  if (currentCredits < needed) {
    return showToast(`Not enough credits. You need ${needed} credits.`);
  }

  if (pixarish && !uploadedImageBase64) {
    return showToast("Please upload an image for Pixar mode.");
  }

  // Build a clean payload with only allowed root keys
  const payload = {
    style,
    prompt,
    count: Number(numImages),
    options: {}
  };

  // If the effective kind is "pixar", move the uploaded image into options.image_base64
  if (pixarish) {
    if (!uploadedImageBase64) {
      showToast("Pixar needs an image — please upload one.");
      return;
    }
    payload.options.image_base64 = uploadedImageBase64; // backend accepts image_base64
  }

  // IMPORTANT: Do NOT include any extra root keys the backend schema doesn't know:
  // - No: upscale, guidance, steps, scheduler, refiner, imageData at the root
  // If you still collect these in the UI, simply omit them from the payload for now.

  generateButton.disabled = true;
  showLoading();

  try {
    const resp = await apiFetch("/generate", { method: "POST", body: payload });
    const images = resp?.images;
    const cost = resp?.cost ?? 0;
    const jobId = resp?.jobId ?? null;
    // If images came back immediately, great.
    // If not, treat it as queued and just redirect to the gallery page.

    // Optionally: store returned data for the gallery page
    sessionStorage.setItem("vaiform_toast", "✅ Images are generating — they’ll appear here shortly.");
    window.location.href = "/my-images.html?from=generate";
    return;
  } catch (err) {
    console.error(err);
    showToast(err.message || "❌ Something went wrong during generation.");
  } finally {
    generateButton.disabled = false;
    hideLoading();
  }
});

/* ========================= UPSCALE ========================= */
async function requestUpscale(imageUrl, btnEl) {
  try {
    btnEl && (btnEl.disabled = true);
    const { images, upscaledUrl, cost, alreadyUpscaled } = await apiFetch("/generate/upscale", {
      method: "POST",
      body: { imageUrl }
    });

    showToast(alreadyUpscaled ? "🔼 Already upscaled (cached)" : "🔼 Upscaled!");

    // If your UI expects a single URL:
    const urlToUse = upscaledUrl || (Array.isArray(images) ? images[0] : null);
    if (urlToUse) {
      // TODO: update your UI with urlToUse
    }
  } catch (e) {
    console.error(e);
    showToast(e.message || "Upscale failed");
  } finally {
    btnEl && (btnEl.disabled = false);
  }
}

/* ========================= DEV: QUICK TOKEN ========================= */
window.getId = async (forceRefresh = true) => {
  try {
    await awaitAuthReadyOnce();
    const u = auth.currentUser;
    if (!u) { console.warn("⚠️ No user signed in"); return null; }
    const t = await u.getIdToken(forceRefresh);
    console.log("ID_TOKEN:", t);
    try { await navigator.clipboard.writeText(t); console.log("✅ Copied ID token to clipboard"); } catch {}
    return t;
  } catch (e) {
    console.error("getId error:", e);
    return null;
  }
};

(function attachPixarHintUX(){
  // --- Pixar auto-hint UX: inject on select, remove on change ---
  const HINT = "Convert the image into a 3D animated style.";
  const styleSel =
    document.querySelector('#style-select') ||
    document.querySelector('#style') ||
    document.querySelector('[name="style"]');
  const promptEl =
    document.querySelector('#prompt') ||
    document.querySelector('#prompt-input') ||
    document.querySelector('[name="prompt"]');
  const fileEl =
    document.querySelector('#image-file') ||
    document.querySelector('#ref-image') ||
    document.querySelector('#img2img-file') ||
    document.querySelector('[name="image"]');

  if (!styleSel || !promptEl) return; // quietly bail if elements missing

  const hasHint = () => promptEl.dataset.hasPixarHint === "1";
  const containsHint = () => promptEl.value.includes(HINT);

  function injectHintIfNeeded() {
    if (containsHint()) {
      // We didn't inject it this session, but it's already there—mark so we can cleanly remove if needed.
      if (!hasHint()) promptEl.dataset.hasPixarHint = "1";
      return;
    }
    if (!promptEl.value.trim()) {
      promptEl.value = HINT;
      promptEl.dataset.hasPixarHint = "1";
    } else {
      // Append once, non-destructive
      promptEl.value = `${promptEl.value.trim()} ${HINT}`.trim();
      promptEl.dataset.hasPixarHint = "1";
    }
  }

  function removeHintIfInjected() {
    if (!hasHint()) return;
    const next = promptEl.value.replace(HINT, "").replace(/\s{2,}/g, " ").trim();
    promptEl.value = next;
    delete promptEl.dataset.hasPixarHint;
  }

  function isPixar(v) {
    return String(v || "").toLowerCase() === "pixar";
  }

  function handleStyleChange() {
    const v = styleSel.value;
    if (isPixar(v)) {
      injectHintIfNeeded();
    } else {
      removeHintIfInjected();
    }
  }

  function handleFileChange() {
    // If user uploads after choosing Pixar and the field is still empty, ensure hint exists
    if (isPixar(styleSel.value) && !promptEl.value.trim()) {
      injectHintIfNeeded();
    }
  }

  // Attach listeners
  styleSel.addEventListener("change", handleStyleChange);
  fileEl?.addEventListener("change", handleFileChange);

  // Run once on load to match current UI state
  handleStyleChange();
})();

/* ========================= INIT ========================= */
(() => {
  applyStyleDefaults(styleSelect?.value || "realistic");
  updateModeIndicator();
  
  // After Firebase auth init is available on the page:
  try {
    setTokenProvider(async () => {
      const u = (window.auth?.currentUser) || (window.firebase?.auth?.().currentUser);
      return u?.getIdToken ? u.getIdToken() : null;
    });
  } catch {}
})();