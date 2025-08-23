import { Router } from "express";
import requireAuth from "../middleware/requireAuth.js";
import * as EnhanceController from "../controllers/enhance.controller.js";

const enhance =
  EnhanceController.enhance ??
  EnhanceController.default ??
  Object.entries(EnhanceController).find(
    ([k, v]) => typeof v === "function" && /enhance/i.test(k)
  )?.[1] ??
  Object.values(EnhanceController).find((v) => typeof v === "function");

if (!enhance) {
  console.error("EnhanceController exports:", Object.keys(EnhanceController));
  throw new Error(
    "enhance.controller.js must export a handler (named or default)."
  );
}

const r = Router();

r.post("/enhance", requireAuth, enhance);
r.post("/", requireAuth, enhance);

export default r;
