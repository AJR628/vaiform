import { Router } from "express";
import generateRouter from "./generate.routes.js";
import creditsRouter from "./credits.routes.js";
import healthRouter from "./health.routes.js";
import webhookRouter from "./webhook.routes.js";
import enhanceRouter from "./enhance.routes.js";
import checkoutRouter from "./checkout.routes.js";
import diagRouter from "./diag.routes.js";
import whoamiRouter from "./whoami.routes.js";
import shortsRouter from "./shorts.routes.js";
import uploadsRouter from "./uploads.routes.js";

// Lightweight root
const index = Router();
index.get("/", (_req, res) => res.json({ success: true, message: "Vaiform API root" }));

export default {
  index,                    // "/"
  health: healthRouter,     // "/health"
  credits: creditsRouter,   // "/credits"
  whoami: whoamiRouter,     // "/whoami"
  enhance: enhanceRouter,   // "/" and "/enhance"
  generate: generateRouter, // "/generate"
  webhook: webhookRouter,   // "/webhook"
  checkout: checkoutRouter, // "/checkout"
  diag: diagRouter,         // "/diag"
  shorts: shortsRouter,     // "/shorts"
  uploads: uploadsRouter,   // "/uploads"
};
