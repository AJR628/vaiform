import { Router } from 'express';
import { enhance, generate, imageToImage, upscale } from '../controllers/generate.controller.js';
import {
  requireAuth,
  requireVerifiedEmail,
  assertUserScoped,
} from '../middleware/auth.middleware.js';
import { validate } from '../middleware/validate.middleware.js';
import {
  EnhanceSchema,
  GenerateSchema,
  ImageToImageSchema,
  UpscaleSchema,
} from '../schemas/generate.schemas.js';

const router = Router();

// Auth wall for all paid endpoints (toggle verified email per your policy)
router.use(requireAuth, requireVerifiedEmail);
router.use(assertUserScoped('uid', 'body'));

// Text → better prompt (costs 1 credit)
router.post('/enhance', validate(EnhanceSchema), enhance);

// Text → image
router.post('/generate', validate(GenerateSchema), generate);

// Image → image (style transform)
router.post('/image-to-image', validate(ImageToImageSchema), imageToImage);

// Upscale
router.post('/upscale', validate(UpscaleSchema), upscale);

export default router;
