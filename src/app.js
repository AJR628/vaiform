import express from "express";
import cors from "cors";
import bodyParser from "body-parser";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";

import routes from "./routes/index.js";
import "./config/firebase.js"; // ensure Firebase Admin is initialized

// Font registration for caption rendering using GlobalFonts API
import pkg from "@napi-rs/canvas";
const { GlobalFonts } = pkg;

function safeRegisterFont(file, family, weight = "normal") {
  try {
    const p = path.join(process.cwd(), "assets", "fonts", file);
    if (!fs.existsSync(p)) throw new Error("missing");
    
    // Use GlobalFonts API which is more reliable
    if (GlobalFonts && typeof GlobalFonts.register === 'function') {
      GlobalFonts.register(p, family);
      console.log(`[font] registered ${file} as ${family}/${weight}`);
      return true;
    } else {
      console.warn(`[font] GlobalFonts.register not available in @napi-rs/canvas`);
      return false;
    }
  } catch (e) {
    console.warn(`[font] register failed for ${file}: ${e.message}`);
    return false;
  }
}

export const HAVE_DEJAVU_BOLD = safeRegisterFont("DejaVuSans-Bold.ttf", "DejaVu-Bold");

// 🔧 Gate A helpers
import envCheck from "./middleware/envCheck.js";
import reqId from "./middleware/reqId.js";
import errorHandler from "./middleware/error.middleware.js";

// Direct route imports for explicit mounting
import healthRoutes from "./routes/health.routes.js";
import whoamiRoutes from "./routes/whoami.routes.js";
import creditsRoutes from "./routes/credits.routes.js";
import diagRoutes from "./routes/diag.routes.js";
import generateRoutes from "./routes/generate.routes.js";
// Old webhook routes removed - using /stripe/webhook instead
import { getCreditsHandler } from "./handlers/credits.get.js";
import diagHeadersRoutes from "./routes/diag.headers.routes.js";
import cdnRoutes from "./routes/cdn.routes.js";

dotenv.config();
envCheck(); // presence-only checks; CI bypasses via NODE_ENV=test

const DBG = process.env.VAIFORM_DEBUG === "1";

const app = express();

// 🪪 assign a request ID early
app.use(reqId);

/** ---- FRONTEND origin (for redirects/CORS) ---- */
const FRONTEND = (process.env.FRONTEND_URL || "http://localhost:8888").replace(/\/+$/, "");
// Include both apex and www just in case the env flips between them
const extraOrigins = Array.from(
  new Set([
    FRONTEND,
    FRONTEND.replace("https://www.", "https://"),
    FRONTEND.replace("https://", "https://www."),
  ])
);

// Helpful boot log
console.info(`[cfg] FRONTEND_URL → ${FRONTEND}`);

// ----- CORS (Netlify + optional preview + local) -----
const ALLOWED_ORIGINS = [
  "https://vaiform.com",
  "https://vaiform-user-name.netlify.app", // replace with your actual Netlify preview URL if used
  "http://localhost:3000",
  "http://localhost:8888" // local development
];

app.use(cors({
  origin(origin, cb) {
    if (!origin) return cb(null, true); // allow curl/healthchecks
    cb(null, ALLOWED_ORIGINS.includes(origin));
  },
  credentials: true
}));

// ---------- Stripe webhook FIRST (before JSON parser) ----------
import stripeWebhook from "./routes/stripe.webhook.js";

// 1) Webhook first (raw)
app.use("/stripe/webhook", stripeWebhook);
console.log("✅ Mounted stripe webhook at /stripe/webhook");

// 2) Then JSON for the rest
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

// 🔎 Diag after parser (keep existing debug middleware)
if (DBG) {
  app.use((req, _res, next) => {
    if (req.path.startsWith("/diag") || req.path.startsWith("/generate")) {
      const ctor = req.body && req.body.constructor ? req.body.constructor.name : typeof req.body;
      console.log("[post-json] body ctor/type =", ctor, "| body =", req.body);
    }
    next();
  });
}

// GET-only trailing-slash normalizer (skip API paths)
app.use((req, res, next) => {
  if (req.method !== "GET") return next();
  const p = req.path || "";
  if (
    p.startsWith("/generate") ||
    p.startsWith("/credits")  ||
    p.startsWith("/whoami")   ||
    p.startsWith("/diag")     ||
    p.startsWith("/health")   ||
    p.startsWith("/stripe/webhook")  ||
    p.startsWith("/api/")
  ) return next();
  if (p.length > 1 && p.endsWith("/")) {
    const q = req.url.slice(p.length);
    return res.redirect(301, p.slice(0, -1) + q);
  }
  next();
});

// ---------- API ROUTES BEFORE STATIC ----------
// Healthcheck (GET + HEAD) and simple diag echo
app.get("/health", (req, res) => {
  res
    .set("Cache-Control", "no-store")
    .json({ ok: true, service: "vaiform-backend", time: Date.now() });
});
app.head("/health", (req, res) => {
  res.set("Cache-Control", "no-store").end();
});
app.post("/diag/echo", (req, res) => {
  res
    .set("Cache-Control", "no-store")
    .json({ ok: true, method: req.method, headers: req.headers, body: req.body, time: Date.now() });
});
console.log("[routes] /health and /diag/echo mounted");

app.use("/", healthRoutes);
app.use("/", whoamiRoutes);
// Keep existing creditsRoutes mount if present, but also provide a direct handler to avoid 404s.
app.use("/", creditsRoutes);
app.get("/credits", getCreditsHandler);
if (process.env.NODE_ENV !== "production") app.use("/diag", diagRoutes);
app.use("/", generateRoutes);
// /api alias for ALL API endpoints (ensure all four are mounted)
app.use("/api", healthRoutes);
app.use("/api", whoamiRoutes);
app.use("/api", creditsRoutes);
app.get("/api/credits", getCreditsHandler);
app.use("/api", generateRoutes);
// Mount diag headers only when VAIFORM_DEBUG=1
if (process.env.VAIFORM_DEBUG === "1") {
  app.use("/api", diagHeadersRoutes);
}

// Guard: prevent GET/HEAD on /generate from being hijacked by static/proxy
app.get(["/generate", "/generate/"], (req, res) =>
  res.status(405).json({ success:false, code:"METHOD_NOT_ALLOWED", message:"Use POST for /generate" })
);
app.head(["/generate", "/generate/"], (req, res) => res.status(405).end());

// Mount other routes that were previously handled by the mount function
if (routes?.index) {
  app.use("/", routes.index);
  console.log("✅ Mounted index at /");
}
if (routes?.enhance) {
  app.use("/", routes.enhance);
  app.use("/enhance", routes.enhance);
  app.use("/api", routes.enhance);
  console.log("✅ Mounted enhance at /, /enhance, and /api");
}
if (routes?.checkout) {
  app.use("/checkout", routes.checkout);
  app.use("/api", routes.checkout);
  console.log("✅ Mounted checkout at /checkout and /api");
}
if (routes?.shorts) {
  // Mount Shorts API for quote-to-shorts MVP
  app.use("/api/shorts", routes.shorts);
  console.log("✅ Mounted shorts at /api/shorts");
}
// Same-origin CDN proxy (optional)
app.use("/cdn", cdnRoutes);
console.log("✅ Mounted cdn at /cdn");
if (routes?.uploads) {
  app.use("/api", routes.uploads);
  console.log("✅ Mounted uploads at /api/uploads");
}
if (routes?.studio) {
  app.use("/api/studio", routes.studio);
  console.log("✅ Mounted studio at /api/studio");
}
if (routes?.quotes) {
  app.use("/api/quotes", routes.quotes);
  app.use("/quotes", routes.quotes);
  console.log("✅ Mounted quotes at /quotes and /api/quotes");
}
if (routes?.assets) {
  app.use("/api/assets", routes.assets);
  app.use("/assets", routes.assets);
  console.log("✅ Mounted assets at /assets and /api/assets");
}
if (routes?.limits) {
  app.use("/api/limits", routes.limits);
  app.use("/limits", routes.limits);
  console.log("✅ Mounted limits at /limits and /api/limits");
}
if (routes?.voice) {
  app.use("/api/voice", routes.voice);
  app.use("/voice", routes.voice);
  console.log("✅ Mounted voice at /voice and /api/voice");
}
if (routes?.creative) {
  app.use("/creative", routes.creative);
  console.log("✅ Mounted creative at /creative");
}
if (routes?.preview) {
  app.use("/api/preview", routes.preview);
  console.log("✅ Mounted preview at /api/preview");
}

// Mount caption preview routes
import captionPreviewRoutes from "./routes/caption.preview.routes.js";
app.use("/api", captionPreviewRoutes);
console.log("✅ Mounted caption preview at /api/caption/preview");

// Mount user routes
import userRoutes from "./routes/user.routes.js";
app.use("/api/user", userRoutes);
console.log("✅ Mounted user routes at /api/user");

// Optional no-op alias for legacy /api/user/setup calls (frontend now uses Firestore)
app.post("/api/user/setup", (req, res) => {
  console.log("[legacy] /api/user/setup called - no-op (frontend uses Firestore)");
  res.status(204).end(); // no content – frontend no longer relies on this
});

// ---------- STATIC LAST (disable directory redirects like /dir -> /dir/) ----------
// --- SPA static hosting (after API routes) ---
try {
  const distDir = path.resolve(process.cwd(), "web", "dist");
  if (fs.existsSync(distDir)) {
    app.use(express.static(distDir, { index: false }));
    app.get(/^\/(?!api\/).*/, (req, res) => {
      res.sendFile(path.join(distDir, "index.html"));
    });
    console.log(`[web] Serving SPA from ${distDir}`);
  } else {
    console.warn(
      `[web] WARNING: ${distDir} not found. Build the web app with: "cd web && npm install && npm run build"`
    );
  }
} catch (e) {
  console.warn("[web] SPA hosting setup failed:", e?.message || e);
}

// Serve assets with correct MIME types
app.use(
  "/assets",
  express.static(path.join(process.cwd(), "assets"), {
    setHeaders: (res, filePath) => {
      if (filePath.endsWith(".ttf"))  res.setHeader("Content-Type", "font/ttf");
      if (filePath.endsWith(".otf"))  res.setHeader("Content-Type", "font/otf");
      if (filePath.endsWith(".woff")) res.setHeader("Content-Type", "font/woff");
      if (filePath.endsWith(".woff2"))res.setHeader("Content-Type", "font/woff2");
    },
  })
);

// Minimal MIME fix for .woff2 (no behavior change for other assets)
app.use((req, res, next) => {
  try {
    if (req.path && req.path.endsWith('.woff2')) {
      res.setHeader('Content-Type', 'font/woff2');
    }
  } catch {}
  next();
});
app.use(express.static("public", { redirect: false }));

// Optional route table when VAIFORM_DEBUG=1
if (process.env.VAIFORM_DEBUG === "1" && app?._router?.stack) {
  const list = [];
  app._router.stack.forEach((m) => {
    if (m.route && m.route.path) {
      const methods = Object.keys(m.route.methods).join(",").toUpperCase();
      list.push(`${methods.padEnd(6)} ${m.route.path}`);
    }
  });
  console.log("🛣️  Routes:\n" + list.sort().join("\n"));
}

/** ---- Centralized error handler (last) ---- */
app.use(errorHandler);

export default app;