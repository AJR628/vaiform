import { Router } from "express";
import requireAuth from "../middleware/requireAuth.js";
import { enhance } from "../controllers/enhance.controller.js";

const router = Router();

router.post("/enhance-image", requireAuth, enhance);

export default router;
