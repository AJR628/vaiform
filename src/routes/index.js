// src/routes/index.js
import { Router } from "express";
import generateRouter from "./generate.routes.js";
import creditsRouter from "./credits.routes.js";
import healthRouter from "./health.routes.js";
import webhookRouter from "./webhook.routes.js";
import enhanceRouter from "./enhance.routes.js";

// Root router for "/" (keep this lightweight)
const index = Router();
index.use("/", healthRouter);

// Export all routers so app.js can mount them explicitly
export default {
  index,             // mount at "/"
  generate: generateRouter,   // mount at "/"
  enhance: enhanceRouter,     // mount at "/"
  credits: creditsRouter,     // mount at "/credits"
  health: healthRouter,       // optional: also mount at "/health" if desired
  webhook: webhookRouter      // mount with raw body at "/webhook" in app.js
};