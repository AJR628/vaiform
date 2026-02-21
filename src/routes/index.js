import { Router } from 'express';
import generateRouter from './generate.routes.js';
import creditsRouter from './credits.routes.js';
import healthRouter from './health.routes.js';
import webhookRouter from './stripe.webhook.js';
import enhanceRouter from './enhance.routes.js';
import checkoutRouter from './checkout.routes.js';
import diagRouter from './diag.routes.js';
import whoamiRouter from './whoami.routes.js';
import shortsRouter from './shorts.routes.js';
import assetsRouter from './assets.routes.js';
import limitsRouter from './limits.routes.js';
import storyRouter from './story.routes.js';

// Lightweight root
const index = Router();
index.get('/', (_req, res) => res.json({ success: true, data: { service: 'vaiform-api-root' } }));

export default {
  index, // "/"
  health: healthRouter, // "/health"
  credits: creditsRouter, // "/credits"
  whoami: whoamiRouter, // "/whoami"
  enhance: enhanceRouter, // "/" and "/enhance"
  generate: generateRouter, // "/generate"
  webhook: webhookRouter, // "/webhook"
  checkout: checkoutRouter, // "/checkout"
  diag: diagRouter, // "/diag"
  shorts: shortsRouter, // "/shorts"
  assets: assetsRouter, // "/assets"
  limits: limitsRouter, // "/limits"
  story: storyRouter, // "/story"
};
