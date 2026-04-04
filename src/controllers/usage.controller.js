import { ok } from '../http/respond.js';
import { failInternalServerError } from '../http/internal-error.js';
import { getUsageSummary } from '../services/usage.service.js';
import logger from '../observability/logger.js';
import { setRequestContextFromReq } from '../observability/request-context.js';

export async function getUsage(req, res) {
  try {
    setRequestContextFromReq(req);
    const uid = req.user.uid;
    const email = req.user.email ?? null;
    const data = await getUsageSummary(uid, email);
    return ok(req, res, data);
  } catch (err) {
    logger.error('auth.bootstrap.usage.failed', {
      routeStatus: `${req.method} ${req.originalUrl}`,
      error: err,
    });
    return failInternalServerError(req, res, 'USAGE_ERROR', 'Failed to fetch usage');
  }
}

export default { getUsage };
