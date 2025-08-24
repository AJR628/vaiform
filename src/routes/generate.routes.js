import { Router } from "express";
import requireAuth from "../middleware/requireAuth.js";
// if you have idempotency, keep it here:
// import idempotency from "../middleware/idempotency.firestore.js";
import { generate } from "../controllers/generate.controller.js";

const r = Router();

// Ensure this is POST /generate (no trailing slash in the route string)
r.post("/generate", requireAuth, /* idempotency, */ generate);

export default r;
