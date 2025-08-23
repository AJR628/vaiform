import { Router } from "express";
import requireAuth from "../middleware/requireAuth.js";
import idempotency from "../middleware/idempotency.firestore.js";

// Tolerant import for validate (works with either `export const validate` or `export default`)
import * as Validate from "../middleware/validate.middleware.js";
const validate = Validate.validate ?? Validate.default;

// Tolerant import for controller (works with either named or default export)
import * as GenerateController from "../controllers/generate.controller.js";
const generate = GenerateController.generate ?? GenerateController.default;

const r = Router();

// Order: validate -> auth -> idempotency -> controller
r.post("/generate", validate, requireAuth, idempotency, generate);

export default r;
