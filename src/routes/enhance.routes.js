import { Router } from "express";
import requireAuth from "../middleware/requireAuth.js";
import { validate } from "../middleware/validate.middleware.js";
import { EnhanceSchema } from "../schemas/enhance.schema.js";
import { enhanceController } from "../controllers/enhance.controller.js";

const r = Router();

r.post("/enhance-image", requireAuth, validate(EnhanceSchema), enhanceController);

export default r;
