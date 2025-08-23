import { Router } from "express";
import requireAuth from "../middleware/requireAuth.js";
import { enhanceController } from "../controllers/enhance.controller.js";

const router = Router();

router.post("/enhance-image", requireAuth, enhanceController);

export default router;
