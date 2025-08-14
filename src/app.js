// src/app.js
import express from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';
import dotenv from 'dotenv';

import routes from './routes/index.js';
import './config/firebase.js'; // ensure Firebase Admin is initialized

// 🔧 Gate A helpers
import envCheck from './middleware/envCheck.js';
import reqId from './middleware/reqId.js';
import errorHandler from './middleware/error.middleware.js';

dotenv.config();
envCheck(); // presence-only checks; CI bypasses via NODE_ENV=test

const app = express();

// 🪪 assign a request ID early
app.use(reqId);

/** ---- CORS (allow Authorization for Firebase ID tokens) ---- */
const corsOptions = {
  origin: [
    'http://localhost:8888',
    'http://localhost:3000',
    'https://vaiform.netlify.app',
    /https:\/\/.*-vaiform\.netlify\.app$/, // Netlify previews
    'https://vaiform.com',
    'https://www.vaiform.com',
    'https://17e0d1d1-e327-483d-b1ea-c41bea08fb59-00-1ef93t84nlhq6.janeway.replit.dev',
  ],
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Idempotency-Key', 'X-Request-Id'],
  credentials: false,
};
app.use(cors(corsOptions));
app.options('*', cors(corsOptions));

/** Helper to mount routes safely and log useful errors */
function mount(name, path, handler) {
  if (typeof handler !== 'function') {
    console.error(
      `❌ Mount failed: "${name}" at "${path}" is not a middleware function/Router (got: ${typeof handler}). ` +
        `Check ./routes/index.js export for "${name}".`
    );
    return;
  }
  app.use(path, handler);
  console.log(`✅ Mounted "${name}" at ${path}`);
}

/** ---- Stripe webhook (raw body FIRST) ---- */
if (routes?.webhook) {
  app.use('/webhook', bodyParser.raw({ type: 'application/json' }), (req, res, next) =>
    routes.webhook(req, res, next)
  );
  console.log('✅ Mounted webhook at /webhook (Stripe raw body parser active)');
} else {
  console.warn("⚠️ No 'webhook' export found in ./routes/index.js");
}

/** ---- JSON parser for the rest ---- */
app.use(express.json({ limit: '10mb' }));

/** ---- Simple health (public, fast) ---- */
app.get('/health', (_req, res) => res.json({ ok: true, message: 'Vaiform backend is running 🚀' }));

/** ---- Mount app routers (scoped paths to avoid collisions) ---- */
mount('index', '/', routes?.index); // GET /
mount('credits', '/credits', routes?.credits); // /credits
mount('enhance', '/enhance', routes?.enhance); // /enhance
mount('generate', '/generate', routes?.generate); // /generate
// 🚧 Future features: mount later under their own paths

/** ---- Centralized error handler (last) ---- */
app.use(errorHandler);

export default app;
