// src/routes/index.js
import { Router } from "express";
import generateRouter from "./generate.routes.js";
import creditsRouter from "./credits.routes.js";
import healthRouter from "./health.routes.js";
import webhookRouter from "./webhook.routes.js"; // ✅ now imported

// Root router for anything you want at "/"
const index = Router();

// Health endpoints (GET /health, diagnostics, etc.)
index.use("/", healthRouter);

// Generation endpoints (/generate, /enhance, /image-to-image, /upscale)
index.use("/", generateRouter);

// Export an object so app.js can mount them individually
export default {
  index,                  // mounts at "/"
  generate: generateRouter, // mounts at "/" because it contains its own paths
  credits: creditsRouter,    // mounts at "/credits"
  health: healthRouter,      // optional: can be mounted at "/health" as well
  webhook: webhookRouter     // ✅ webhook now exposed for app.js raw-body mount
};