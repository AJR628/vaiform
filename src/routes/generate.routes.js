import { Router } from "express";
import requireAuth from "../middleware/auth.js";
import { validate } from "../middleware/validate.middleware.js";

// 🔒 Firestore-backed idempotency (prod-safe)
import idempotency from "../middleware/idempotency.firestore.js";

import {
  GenerateSchema,
  ImageToImageSchema,
  UpscaleSchema,
} from "../schemas/generate.schema.js";

import {
  generate,
  imageToImage,
  upscale,
} from "../controllers/generate.controller.js";

const router = Router();

/**
 * Mounted at /generate in app.js:
 *   app.use("/generate", generateRoutes)
 *
 * Endpoints:
 *   POST /generate                -> text-to-image
 *   POST /generate/image-to-image -> image-to-image
 *   POST /generate/upscale        -> upscaler
 *
 * Required headers for POSTs:
 *   - Authorization: Bearer <ID_TOKEN>
 *   - X-Idempotency-Key: <unique-per-attempt>
 */

/** POST /generate  (txt2img) */
router.post(
  "/",
  requireAuth,
  validate(GenerateSchema),      // ✅ validate first (no idempotency write on 400s)
  idempotency({ ttlMinutes: 60 }),
  generate
);

/** POST /generate/image-to-image  (img2img) */
router.post(
  "/image-to-image",
  requireAuth,
  validate(ImageToImageSchema),  // ✅ validate first
  idempotency({ ttlMinutes: 60 }),
  imageToImage
);

/** POST /generate/upscale  */
router.post(
  "/upscale",
  requireAuth,
  validate(UpscaleSchema),       // ✅ validate first
  idempotency({ ttlMinutes: 60 }),
  upscale
);

export default router;
