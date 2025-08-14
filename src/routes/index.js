// src/routes/index.js
import { Router } from 'express';
import generateRouter from './generate.routes.js';
import creditsRouter from './credits.routes.js';
import healthRouter from './health.routes.js';
import webhookRouter from './webhook.routes.js';
import enhanceRouter from './enhance.routes.js';

// Root router for "/" (lightweight; serves health + any root info)
const index = Router();
index.use('/', healthRouter);

// Export routers; app.js mounts them explicitly with paths
export default {
  index, // mounts at "/"
  generate: generateRouter, // mounts at "/generate"
  enhance: enhanceRouter, // mounts at "/enhance"
  credits: creditsRouter, // mounts at "/credits"
  health: healthRouter, // optional: could also mount at "/health"
  webhook: webhookRouter, // mounted at "/webhook" with raw body in app.js
};
