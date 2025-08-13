import { Router } from 'express';
import {
  root,
  healthz,
  version,
  testFirestore,
  register,
} from '../controllers/health.controller.js';

const router = Router();

router.get('/', root);
router.get('/healthz', healthz);
router.get('/version', version);
router.get('/test-firestore', testFirestore);
router.post('/register', register);

export default router;
