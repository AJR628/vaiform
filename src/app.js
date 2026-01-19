import express from "express";
import cors from "cors";
import bodyParser from "body-parser";
import helmet from "helmet";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";

import routes from "./routes/index.js";
import "./config/firebase.js"; // ensure Firebase Admin is initialized

// Font registration moved to src/caption/canvas-fonts.js and called from server.js

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

// Trust proxy (before routes)
app.set("trust proxy", Number(process.env.TRUST_PROXY_HOPS || 1));

// Security headers (CSP disabled for SPA compatibility)
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false,
}));

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
  "https://www.vaiform.com", // www subdomain
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

// 1.5) Conditional 200kb JSON parser for specific routes (BEFORE global parser)
const CAPTION_PREVIEW_PATHS = ["/api/caption/preview", "/api/caption/render", "/api/tts/preview"];
const json200kb = express.json({ limit: "200kb" });
app.use((req, res, next) => {
  if (CAPTION_PREVIEW_PATHS.includes(req.path)) {
    return json200kb(req, res, next);
  }
  next();
});

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

// ---------- STATIC FILES FIRST (before API routes to avoid shadowing) ----------
// Serve /assets/fonts with correct MIME types and CORS headers
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

app.use("/assets/fonts", (req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET");
  next();
});

console.log("✅ Mounted static /assets (fonts) before API routes");

// ---------- API ROUTES ----------
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
// PHASE 1: Unmounted non-core studio routes (code preserved)
// if (routes?.studio) {
//   app.use("/api/studio", routes.studio);
//   console.log("✅ Mounted studio at /api/studio");
// }
// PHASE 1: Unmounted non-core quotes routes (code preserved)
// if (routes?.quotes) {
//   app.use("/api/quotes", routes.quotes);
//   app.use("/quotes", routes.quotes);
//   console.log("✅ Mounted quotes at /quotes and /api/quotes");
// }
if (routes?.assets) {
  app.use("/api/assets", routes.assets);
  console.log("✅ Mounted assets API at /api/assets");
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
// PHASE 1: Unmounted legacy preview routes (code preserved)
// Legacy /api/preview/caption replaced by /api/caption/preview (V3 raster mode)
// if (routes?.preview) {
//   app.use("/api/preview", routes.preview);
//   console.log("✅ Mounted preview at /api/preview");
// }
if (routes?.tts) {
  app.use("/api/tts", routes.tts);
  console.log("✅ Mounted tts at /api/tts");
}
if (routes?.story) {
  app.use("/api/story", routes.story);
  console.log("✅ Mounted story at /api/story");
}

// Mount caption preview routes
import captionPreviewRoutes from "./routes/caption.preview.routes.js";
app.use("/api", captionPreviewRoutes);
console.log("✅ Mounted caption preview at /api/caption/preview");

// Mount caption render routes
import captionRenderRoutes from "./routes/caption.render.routes.js";
app.use("/api", captionRenderRoutes);
console.log("✅ Mounted caption render at /api/caption/render");

// Mount user routes
import userRoutes from "./routes/user.routes.js";
app.use("/api/user", userRoutes);
console.log("✅ Mounted user routes at /api/user");

// Mount users routes (plural) for /api/users/ensure
import usersRoutes from "./routes/users.routes.js";
app.use("/api/users", usersRoutes);
console.log("✅ Mounted users routes at /api/users");

// Optional no-op alias for legacy /api/user/setup calls (frontend now uses Firestore)
app.post("/api/user/setup", (req, res) => {
  console.log("[legacy] /api/user/setup called - no-op (frontend uses Firestore)");
  res.status(204).end(); // no content – frontend no longer relies on this
});

// PHASE 1: Core routers summary
console.log("📋 Mounted core routes: story, caption (preview/render), tts, voice, checkout, credits (GET only), users, user, shorts-readonly");

// ---------- STATIC LAST (disable directory redirects like /dir -> /dir/) ----------
// --- SPA static hosting (after API routes) ---
try {
  const distDir = path.resolve(process.cwd(), "web", "dist");
  if (fs.existsSync(distDir)) {
    app.use(express.static(distDir, { index: false }));
    app.get(/^\/(?!api\/|assets\/).*/, (req, res) => {
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