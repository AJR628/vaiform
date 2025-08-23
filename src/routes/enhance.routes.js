import { Router } from "express";
import requireAuth from "../middleware/requireAuth.js";
import { enhanceController } from "../controllers/enhance.controller.js";

const r = Router();
r.post("/enhance-image", requireAuth, enhanceController);

export default r;
