import { Router } from "express";
import requireAuth from "../middleware/requireAuth.js";
import * as EnhanceController from "../controllers/enhance.controller.js";

// Try named -> default -> a function with "enhance" in its name -> first function export
const enhance =
  EnhanceController.enhanceController ??
  EnhanceController.default ??
  Object.entries(EnhanceController).find(
    ([k, v]) => typeof v === "function" && /enhance/i.test(k)
  )?.[1] ??
  Object.values(EnhanceController).find((v) => typeof v === "function");

if (!enhance) {
  // Helpful debug if this ever happens again:
  // eslint-disable-next-line no-console
  console.error("EnhanceController exports:", Object.keys(EnhanceController));
  throw new Error(
    "enhance.controller.js must export a handler (named or default)."
  );
}

const r = Router();

// Auth required; NO idempotency
r.post("/enhance", requireAuth, enhance);

// Optional legacy alias
r.post("/", requireAuth, enhance);

export default r;
