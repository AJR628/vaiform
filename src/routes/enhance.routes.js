import { Router } from "express";
import { enhanceImage } from "../controllers/enhance.controller.js";
import requireAuth from "../middleware/auth.js";

const router = Router();
router.post("/enhance-image", requireAuth, enhanceImage);

export default router;