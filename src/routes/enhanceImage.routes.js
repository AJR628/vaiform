import { Router } from "express";
import requireAuth from "../middleware/requireAuth.js";
import { enhanceImageController } from "../controllers/enhance.controller.js";

const router = Router();

router.post("/enhance-image", requireAuth, enhanceImageController);

export default router;