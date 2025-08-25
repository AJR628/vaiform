import express from "express";
import cors from "cors";
import bodyParser from "body-parser";
import dotenv from "dotenv";

import routes from "./routes/index.js";
import "./config/firebase.js"; // ensure Firebase Admin is initialized

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
import webhookRoutes from "./routes/webhook.routes.js";

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

// ---------- Parsers FIRST ----------
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

// ---------- Stripe webhook: raw body ONLY here ----------
app.post("/webhook", express.raw({ type: "application/json" }), webhookRoutes);

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
    p.startsWith("/webhook")  ||
    p.startsWith("/api/")
  ) return next();
  if (p.length > 1 && p.endsWith("/")) {
    const q = req.url.slice(p.length);
    return res.redirect(301, p.slice(0, -1) + q);
  }
  next();
});

// ---------- API ROUTES BEFORE STATIC ----------
app.use("/", healthRoutes);
app.use("/", whoamiRoutes);
app.use("/", creditsRoutes);
if (process.env.NODE_ENV !== "production") app.use("/diag", diagRoutes);
app.use("/", generateRoutes);
// /api alias for ALL API endpoints so the frontend can use one stable base
app.use("/api", healthRoutes);
app.use("/api", whoamiRoutes);
app.use("/api", creditsRoutes);
if (process.env.NODE_ENV !== "production") app.use("/api", diagRoutes);
app.use("/api", generateRoutes);

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

// ---------- STATIC LAST (disable directory redirects like /dir -> /dir/) ----------
app.use(express.static("public", { redirect: false }));

// Optional: route table log to verify mounts when VAIFORM_DEBUG=1
if (DBG) {
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