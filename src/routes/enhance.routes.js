import { Router } from "express";
import { requireAuth } from "../middleware/requireAuth.js";
import { enhance } from "../controllers/enhance.controller.js";

const r = Router();

/**
 * POST /enhance
 * Auth required; NO idempotency.
 */
r.post("/enhance", requireAuth, enhance);

/**
 * (optional alias) POST /
 * Some older frontends may POST to "/"
 */
r.post("/", requireAuth, enhance);

export default r;