import { Router } from 'express';
import requireAuth from '../middleware/requireAuth.js';
import { validate } from '../middleware/validate.middleware.js';
import { AssetsOptionsSchema } from '../schemas/quotes.schema.js';
import { getAssetsOptions } from '../controllers/assets.controller.js';
import { fail } from '../http/respond.js';

const r = Router();

r.post('/options', requireAuth, validate(AssetsOptionsSchema), getAssetsOptions);
// [AI_IMAGES] Route left in place but hard-disabled for v1 (no backend calls to providers)
r.post('/ai-images', requireAuth, (req, res) => {
  return fail(
    req,
    res,
    410,
    'FEATURE_DISABLED',
    'AI image generation is not available in this version of Vaiform.'
  );
});

export default r;
