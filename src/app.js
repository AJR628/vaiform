// src/app.js
import express from "express";
import cors from "cors";
import bodyParser from "body-parser";
import routes from "./routes/index.js";

const app = express();

// ---- Middleware (global) ----
app.use(cors());

// Helper to mount routes safely and log useful errors
function mount(name, path, handler) {
  if (typeof handler !== "function") {
    console.error(
      `❌ Mount failed: "${name}" at path "${path}" is not a middleware function/Router. Got: ${typeof handler}. ` +
      `Check your exports in ./routes/index.js for "${name}".`
    );
    return;
  }
  app.use(path, handler);
  console.log(`✅ Mounted "${name}" at ${path}`);
}

// ---- Webhook (raw body FIRST, before any JSON parser) ----
if (routes?.webhook) {
  app.use(
    "/webhook",
    bodyParser.raw({ type: "application/json" }),
    (req, res, next) => {
      if (typeof routes.webhook !== "function") {
        console.error(
          `❌ "webhook" is not a function. Got: ${typeof routes.webhook}. ` +
          `Export a function or Router from ./routes/index.js`
        );
        return res.status(500).send("Webhook misconfigured");
      }
      return routes.webhook(req, res, next);
    }
  );
  console.log("✅ Mounted webhook at /webhook (Stripe raw body parser active)");
} else {
  console.warn("⚠️ No 'webhook' export found in ./routes/index.js");
}

// ---- JSON parsing for everything else ----
app.use(express.json({ limit: "10mb" }));

// ---- Health check ----
app.get("/health", (req, res) => res.json({ ok: true }));

// ---- Mount remaining routers ----
mount("index", "/", routes?.index);
mount("generate", "/", routes?.generate); // mounted at "/" because generateRouter defines its own paths
mount("credits", "/credits", routes?.credits);

// Optionally mount health router if provided
if (routes?.health) {
  mount("health (router)", "/health", routes.health);
}

export default app;