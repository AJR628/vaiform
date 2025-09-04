import { Router } from "express";
import multer from "multer";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import requireAuth from "../middleware/requireAuth.js";
import { uploadPublic } from "../utils/storage.js";

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

r.post("/uploads/image", requireAuth, upload.single("file"), async (req, res) => {
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


