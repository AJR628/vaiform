import { Router } from "express";
import requireAuth from "../middleware/requireAuth.js";
import idempotency from "../middleware/idempotency.firestore.js";
import { validate } from "../middleware/validate.js";
import * as GenerateController from "../controllers/generate.controller.js";
const generate = GenerateController.generate ?? GenerateController.default;

const r = Router();
r.post("/generate", validate, requireAuth, idempotency, generate);
export default r;
