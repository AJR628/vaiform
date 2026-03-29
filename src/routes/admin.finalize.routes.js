import express, { Router } from 'express';
import path from 'path';

import { fail, ok } from '../http/respond.js';
import {
  isFinalizeDashboardEnabled,
  requireFinalizeDashboardDataEnabled,
  requireFinalizeDashboardFounder,
} from '../middleware/finalizeDashboardAccess.js';
import requireAuth from '../middleware/requireAuth.js';
import { buildFinalizeDashboardPayload } from '../services/finalize-dashboard.service.js';

const router = Router();

const dashboardDir = path.resolve('src', 'internal', 'finalize-dashboard');
const vendorDir = path.resolve('web', 'public', 'js');

router.use(
  '/admin/finalize',
  (req, res, next) => {
    if (!isFinalizeDashboardEnabled()) {
      return res.status(404).end();
    }
    return next();
  },
  express.static(dashboardDir, {
    index: false,
    redirect: false,
    setHeaders(res) {
      res.setHeader('Cache-Control', 'no-store');
    },
  })
);

router.get('/admin/finalize/vendor/firebaseClient.js', (req, res) => {
  if (!isFinalizeDashboardEnabled()) {
    return res.status(404).end();
  }
  res.set('Cache-Control', 'no-store');
  return res.sendFile(path.join(vendorDir, 'firebaseClient.js'));
});

router.get('/admin/finalize', (req, res) => {
  if (!isFinalizeDashboardEnabled()) {
    return res.status(404).end();
  }
  res.set('Cache-Control', 'no-store');
  return res.sendFile(path.join(dashboardDir, 'index.html'));
});

router.get(
  '/api/admin/finalize/data',
  requireFinalizeDashboardDataEnabled,
  requireAuth,
  requireFinalizeDashboardFounder,
  async (req, res) => {
    try {
      res.set('Cache-Control', 'no-store');
      return ok(req, res, await buildFinalizeDashboardPayload());
    } catch (error) {
      return fail(
        req,
        res,
        500,
        'FINALIZE_DASHBOARD_DATA_FAILED',
        error?.message || 'FINALIZE_DASHBOARD_DATA_FAILED'
      );
    }
  }
);

export default router;
