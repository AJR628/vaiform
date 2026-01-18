import express, { Router } from "express";
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { ttsPreview } from "../controllers/tts.controller.js";
import requireAuth from "../middleware/requireAuth.js";
const r = Router();

const ttsPreviewRateLimit = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 5, // 5 requests per minute
  keyGenerator: (req) => req.user?.uid || ipKeyGenerator(req.ip), // Defensive fallback
  skip: (req) => req.method === "OPTIONS", // Skip CORS preflights
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    res.status(429).json({ 
      success: false, 
      error: 'RATE_LIMIT_EXCEEDED', 
      detail: 'Too many requests. Please try again in a minute.' 
    });
  }
});

// Mounted at /api/tts, so this becomes /api/tts/preview
r.post("/preview", requireAuth, ttsPreviewRateLimit, express.json({ limit: "200kb" }), ttsPreview);
export default r;
