import { Router } from "express";
import { ttsPreview } from "../controllers/tts.controller.js";
const r = Router();
// Mounted at /api/tts, so this becomes /api/tts/preview
r.post("/preview", ttsPreview);
export default r;
