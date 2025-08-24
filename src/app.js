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

/** Helper to mount routes safely and log useful errors */
function mount(name, path, handler) {
  if (typeof handler !== "function") {
    console.error(
      `❌ Mount failed: "${name}" at "${path}" is not a middleware function/Router (got: ${typeof handler}). ` +
        `Check ./routes/index.js export for "${name}".`
    );
    return;
  }
  app.use(path, handler);
  console.log(`✅ Mounted "${name}" at ${path}`);
}

// 🔎 Diag before parser
if (DBG) {
  app.use((req, _res, next) => {
    if (req.path.startsWith("/diag") || req.path.startsWith("/generate")) {
      console.log("[pre-json] CT=", req.headers["content-type"]);
    }
    next();
  });
}

// ✅ Parsers FIRST
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

// 🔎 Diag after parser
if (DBG) {
  app.use((req, _res, next) => {
    if (req.path.startsWith("/diag") || req.path.startsWith("/generate")) {
      const ctor = req.body && req.body.constructor ? req.body.constructor.name : typeof req.body;
      console.log("[post-json] body ctor/type =", ctor, "| body =", req.body);
    }
    next();
  });
}

/** ---- Stripe webhook (raw body FIRST) ---- */
if (routes?.webhook) {
  app.post("/webhook", express.raw({ type: "application/json" }), (req, res, next) =>
    routes.webhook(req, res, next)
  );
  console.log("✅ Mounted webhook at /webhook (Stripe raw body parser active)");
} else {
  console.warn("⚠️ No 'webhook' export found in ./routes/index.js");
}

// ---- Mount app routers (scoped paths) ----
mount("index", "/", routes?.index);                 
mount("health", "/health", routes?.health);         
mount("credits", "/credits", routes?.credits);      
mount("whoami", "/whoami", routes?.whoami);         
mount("generate", "/generate", routes?.generate);   

mount("enhance", "/", routes?.enhance);                 
mount("enhance (alias)", "/enhance", routes?.enhance);  

mount("checkout", "/checkout", routes?.checkout);   

// ✅ NEW: diagnostics
if (process.env.NODE_ENV !== "production") {
  mount("diag", "/diag", routes?.diag);
}

/** ---- Centralized error handler (last) ---- */
app.use(errorHandler);

export default app;