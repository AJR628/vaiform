import express, { Router } from "express";
import { ttsPreview } from "../controllers/tts.controller.js";
import requireAuth from "../middleware/requireAuth.js";
const r = Router();
// Mounted at /api/tts, so this becomes /api/tts/preview
r.post("/preview", express.json({ limit: "200kb" }), requireAuth, ttsPreview);
export default r;
