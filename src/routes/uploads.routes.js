import { Router } from "express";
import multer from "multer";
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import requireAuth from "../middleware/requireAuth.js";
import { uploadPublic } from "../utils/storage.js";
import { saveImageFromUrl } from "../services/storage.service.js";

const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const EXT_BY_TYPE = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
};

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 },
});

const r = Router();

const uploadRateLimit = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 10, // 10 requests per minute (more generous than preview - file uploads are less CPU-intensive)
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

r.post("/uploads/image", requireAuth, uploadRateLimit, upload.single("file"), async (req, res) => {
  try {
    const ownerUid = req.user?.uid;
    if (!ownerUid) return res.status(401).json({ success: false, error: "UNAUTHENTICATED", message: "Login required" });

    const f = req.file;
    if (!f) {
      return res.status(400).json({ success: false, error: "INVALID_INPUT", detail: { fieldErrors: { file: ["File is required"] } } });
    }
    const type = f.mimetype;
    if (!ALLOWED_TYPES.has(type)) {
      return res.status(400).json({ success: false, error: "INVALID_INPUT", detail: { fieldErrors: { file: ["Unsupported MIME type"] } } });
    }
    const ext = EXT_BY_TYPE[type] || "";

    const tmpPath = join(tmpdir(), `vaiform-upload-${randomUUID()}${ext || ""}`);
    await fs.writeFile(tmpPath, f.buffer);

    const dest = `artifacts/${ownerUid}/uploads/${randomUUID()}${ext}`;
    const { publicUrl } = await uploadPublic(tmpPath, dest, type);

    try { await fs.unlink(tmpPath); } catch {}

    return res.json({ success: true, data: { uploadUrl: publicUrl } });
  } catch (err) {
    const code = err?.code === "LIMIT_FILE_SIZE" ? 400 : 500;
    const payload = err?.code === "LIMIT_FILE_SIZE"
      ? { success: false, error: "INVALID_INPUT", detail: { fieldErrors: { file: ["File too large (max 8MB)"] } } }
      : { success: false, error: "UPLOAD_FAILED", message: err?.message || "Upload failed" };
    return res.status(code).json(payload);
  }
});

export default r;

// Register a remote image URL into storage and return a tokenized URL
r.post("/uploads/register", requireAuth, uploadRateLimit, async (req, res) => {
  try {
    const ownerUid = req.user?.uid;
    if (!ownerUid) return res.status(401).json({ success: false, error: "UNAUTHENTICATED" });
    const imageUrl = String(req.body?.imageUrl || '').trim();
    if (!/^https?:\/\//i.test(imageUrl)) {
      return res.status(400).json({ success:false, error:"INVALID_INPUT", message:"imageUrl required" });
    }
    const jobId = `register-${Date.now()}`;
    const saved = await saveImageFromUrl(ownerUid, jobId, imageUrl, { index: 0, recompress: false });
    return res.json({ success:true, data: { url: saved.publicUrl } });
  } catch (e) {
    return res.status(500).json({ success:false, error:"REGISTER_FAILED", message: e?.message || 'failed' });
  }
});


