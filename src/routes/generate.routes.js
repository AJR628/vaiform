import { Router } from "express";
import requireAuth from "../middleware/requireAuth.js";
import { generate } from "../controllers/generate.controller.js";

const r = Router();

// CORRECT: define the route at "/" so the mount prefix provides "/generate"
r.post("/", requireAuth, generate);

export default r;
