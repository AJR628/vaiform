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
import uploadsRouter from './uploads.routes.js';
import studioRouter from './studio.routes.js';
import quotesRouter from './quotes.routes.js';
import assetsRouter from './assets.routes.js';
import limitsRouter from './limits.routes.js';
import creativeRouter from './creative.routes.js';
import voiceRouter from './voice.routes.js';
import previewRouter from './preview.routes.js';
import ttsRouter from './tts.routes.js';
import storyRouter from './story.routes.js';

// Lightweight root
const index = Router();
index.get('/', (_req, res) => res.json({ success: true, message: 'Vaiform API root' }));

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
  uploads: uploadsRouter, // "/uploads"
  studio: studioRouter, // "/studio"
  quotes: quotesRouter, // "/generate-quote"
  assets: assetsRouter, // "/assets"
  limits: limitsRouter, // "/limits"
  creative: creativeRouter, // "/creative"
  voice: voiceRouter, // "/voice"
  preview: previewRouter, // "/preview"
  tts: ttsRouter, // "/tts"
  story: storyRouter, // "/story"
};
