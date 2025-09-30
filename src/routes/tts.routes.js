import { Router } from "express";
import { ttsPreview } from "../controllers/tts.controller.js";
const r = Router();
// Optional: requireAuth middleware if preview is gated
r.post("/tts/preview", ttsPreview);
export default r;
