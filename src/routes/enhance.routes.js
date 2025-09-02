import { Router } from "express";
import requireAuth from "../middleware/requireAuth.js";
import { validate } from "../middleware/validate.middleware.js";
import { enhance } from "../controllers/enhance.controller.js";

const r = Router();

// Auth required
r.post("/enhance-image", requireAuth, validate(EnhanceSchema), enhance);

export default r;
