import { Router } from "express";
import { requireAuth } from "../middleware/requireAuth.js";
import idempotency from "../middleware/idempotency.firestore.js";

import { validate } from "../middleware/validate.middleware.js";
import {
  GenerateSchema,
  Img2ImgSchema,
  UpscaleSchema,
} from "../schemas/generate.schema.js";

import {
  generate,
  imageToImage,
  upscale,
} from "../controllers/generate.controller.js";

const r = Router();

/**
 * ORDER MATTERS:
 * 1) validate (fail fast; no idempotency record)
 * 2) requireAuth (so idempotency can use req.user.uid)
 * 3) idempotency (Firestore-backed)
 * 4) controller
 */

// text-to-image
r.post(
  "/",
  validate(GenerateSchema),
  requireAuth,
  idempotency({ ttlMinutes: 60 }),
  generate
);

// image-to-image
r.post(
  "/img2img",
  validate(Img2ImgSchema),
  requireAuth,
  idempotency({ ttlMinutes: 60 }),
  imageToImage
);

// upscale
r.post(
  "/upscale",
  validate(UpscaleSchema),
  requireAuth,
  idempotency({ ttlMinutes: 60 }),
  upscale
);

export default r;
