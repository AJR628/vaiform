// src/routes/health.routes.js
import { Router } from 'express';
import {
  root,
  healthz,
  version,
  testFirestore,
  register,
} from '../controllers/health.controller.js';

const router = Router();

/**
 * Keep all health endpoints PUBLIC and lightweight.
 * Your CI workflow curls /health (from app.js) for heartbeat.
 * These are extra diagnostics you can use manually.
 */
router.get('/', root); // GET /
router.get('/healthz', healthz); // GET /healthz (alt)
router.get('/version', version); // GET /version
router.get('/test-firestore', testFirestore); // GET /test-firestore
router.post('/register', register); // POST /register (simple echo or diag)

export default router;
