import { Router } from "express";
import requireAuth from "../middleware/requireAuth.js";
import { validate } from "../middleware/validate.middleware.js";
import { enhanceController } from "../controllers/enhance.controller.js";

const router = Router();

router.post("/enhance-image", requireAuth, validate((data) => {
  const errorMsg = "Invalid input";
  if (typeof data.prompt !== "string" || data.prompt.trim() === "") {
    throw new Error(errorMsg);
  }
  if (data.strength !== undefined) {
    const s = parseFloat(data.strength);
    if (isNaN(s) || s < 0 || s > 1) {
      throw new Error(errorMsg);
    }
  }
}), enhanceController);

export default router;