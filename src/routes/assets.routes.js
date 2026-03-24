import { Router } from 'express';
import requireAuth from '../middleware/requireAuth.js';
import { validate } from '../middleware/validate.middleware.js';
import { AssetsOptionsSchema } from '../schemas/quotes.schema.js';
import { getAssetsOptions } from '../controllers/assets.controller.js';

const r = Router();

r.post('/options', requireAuth, validate(AssetsOptionsSchema), getAssetsOptions);

export default r;
