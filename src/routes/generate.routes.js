import { Router } from "express";
import requireAuth from "../middleware/requireAuth.js";
import idempotency from "../middleware/idempotency.firestore.js";
import { validate } from "../middleware/validate.middleware.js";
import { GenerateSchema } from "../schemas/generate.schema.js";
import { generate } from "../controllers/generate.controller.js";

const r = Router();

// Ensure this is POST /generate (no trailing slash in the route string)
r.post("/generate", requireAuth, idempotency(), validate(GenerateSchema), generate);

export default r;
