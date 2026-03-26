import { db } from '../config/firebase.js';
import { ok, fail } from '../http/respond.js';
import { persistStoryRenderRecovery } from '../services/story.service.js';
import {
  buildFinalizeHttpReply,
  finalizeAttemptFailure,
  prepareFinalizeAttempt,
  refreshFinalizeQueueMetrics,
} from '../services/story-finalize.attempts.js';
import logger from '../observability/logger.js';
import { setRequestContextFromReq } from '../observability/request-context.js';
import {
  FINALIZE_EVENTS,
  FINALIZE_SOURCE_ROLES,
  FINALIZE_STAGES,
  describeFinalizeError,
  emitFinalizeEvent,
} from '../observability/finalize-observability.js';

const requestIdOf = (req) => req?.id ?? null;

/**
 * Idempotency middleware for POST /api/story/finalize.
 * - Requires X-Idempotency-Key (400 if missing).
 * - Validates req.body.sessionId (non-empty string, min 3 chars) before any Firestore read/reserve; 400 INVALID_INPUT without reserving.
 * - Reserve/enqueue: creates a queued finalize attempt and reserves render seconds once.
 * - Same-key replay: queued/running -> 202 pending, done -> 200 success replay, failed/expired -> terminal failure replay.
 * - Same-session different key while active: 409 FINALIZE_ALREADY_ACTIVE without a second reservation.
 *
 * Verification (curl, no test framework):
 * 1) Missing header: POST without X-Idempotency-Key -> 400 MISSING_IDEMPOTENCY_KEY.
 * 2) Missing/invalid sessionId: POST with key but body {} or { "sessionId": "x" } -> 400 INVALID_INPUT; usage unchanged.
 * 3) Same key twice with valid sessionId: first request enqueues once; replay returns pending or final result without a second reservation.
 *
 * @param {{ ttlMinutes?: number, getSession: (opts: { uid: string, sessionId: string }) => Promise<object|null> }} opts
 */
export function idempotencyFinalize({ ttlMinutes = 60, getSession } = {}) {
  if (typeof getSession !== 'function') {
    throw new Error('idempotencyFinalize requires getSession');
  }
  return async function middleware(req, res, next) {
    const admissionStartedAt = Date.now();
    req.finalizeAdmissionStartedAt = admissionStartedAt;
    const key = req.get('X-Idempotency-Key');
    const uid = req.user?.uid;
    emitFinalizeEvent('info', FINALIZE_EVENTS.API_REQUESTED, {
      sourceRole: FINALIZE_SOURCE_ROLES.API,
      requestId: req.id ?? null,
      route: req.originalUrl,
      uid,
      attemptId: key || null,
      httpStatus: null,
    });
    if (!key) {
      emitFinalizeEvent('warn', FINALIZE_EVENTS.API_REJECTED, {
        sourceRole: FINALIZE_SOURCE_ROLES.API,
        requestId: req.id ?? null,
        route: req.originalUrl,
        uid,
        httpStatus: 400,
        stage: FINALIZE_STAGES.ADMISSION_VALIDATE,
        durationMs: Date.now() - admissionStartedAt,
        ...describeFinalizeError(
          { code: 'MISSING_IDEMPOTENCY_KEY', status: 400 },
          { retryable: false, failureReason: 'missing_idempotency_key' }
        ),
      });
      return fail(req, res, 400, 'MISSING_IDEMPOTENCY_KEY', 'Provide X-Idempotency-Key header.');
    }
    if (!uid) {
      emitFinalizeEvent('warn', FINALIZE_EVENTS.API_REJECTED, {
        sourceRole: FINALIZE_SOURCE_ROLES.API,
        requestId: req.id ?? null,
        route: req.originalUrl,
        attemptId: key,
        httpStatus: 401,
        stage: FINALIZE_STAGES.ADMISSION_VALIDATE,
        durationMs: Date.now() - admissionStartedAt,
        ...describeFinalizeError(
          { code: 'UNAUTHORIZED', status: 401 },
          { retryable: false, failureReason: 'unauthorized' }
        ),
      });
      return fail(req, res, 401, 'UNAUTHORIZED', 'Authentication required.');
    }

    // Validate sessionId before any Firestore read or reserve so invalid input never reserves usage
    const sessionId = typeof req.body?.sessionId === 'string' ? req.body.sessionId.trim() : '';
    if (sessionId.length < 3) {
      emitFinalizeEvent('warn', FINALIZE_EVENTS.API_REJECTED, {
        sourceRole: FINALIZE_SOURCE_ROLES.API,
        requestId: req.id ?? null,
        route: req.originalUrl,
        uid,
        attemptId: key,
        sessionId: sessionId || null,
        httpStatus: 400,
        stage: FINALIZE_STAGES.ADMISSION_VALIDATE,
        durationMs: Date.now() - admissionStartedAt,
        ...describeFinalizeError(
          { code: 'INVALID_INPUT', status: 400 },
          { retryable: false, failureReason: 'invalid_session_id' }
        ),
      });
      return fail(
        req,
        res,
        400,
        'INVALID_INPUT',
        'sessionId required and must be at least 3 characters.'
      );
    }
    setRequestContextFromReq(req, { sessionId, attemptId: key });

    try {
      const prepared = await prepareFinalizeAttempt({
        uid,
        attemptId: key,
        sessionId,
        requestId: req.id ?? null,
        ttlMinutes,
        getSession,
      });

      if (prepared.kind === 'error') {
        emitFinalizeEvent('warn', FINALIZE_EVENTS.API_REJECTED, {
          sourceRole: FINALIZE_SOURCE_ROLES.API,
          requestId: req.id ?? null,
          route: req.originalUrl,
          uid,
          sessionId,
          attemptId: key,
          httpStatus: prepared.status,
          stage:
            prepared.error === 'INSUFFICIENT_RENDER_TIME'
              ? FINALIZE_STAGES.ADMISSION_RESERVE_USAGE
              : FINALIZE_STAGES.ADMISSION_VALIDATE,
          durationMs: Date.now() - admissionStartedAt,
          ...describeFinalizeError(
            { code: prepared.error, status: prepared.status, message: prepared.detail },
            { retryable: false, failureReason: prepared.error }
          ),
        });
        return fail(req, res, prepared.status, prepared.error, prepared.detail);
      }

      if (prepared.kind === 'enqueued') {
        const pendingSession = await persistStoryRenderRecovery({
          uid,
          sessionId,
          attemptId: key,
          state: 'pending',
        });
        if (!pendingSession) {
          await finalizeAttemptFailure({
            uid,
            attemptId: key,
            status: 500,
            error: 'SESSION_NOT_FOUND',
            detail: 'Session not found',
          });
          return fail(req, res, 404, 'SESSION_NOT_FOUND', 'Session not found');
        }
        prepared.session = pendingSession;
        emitFinalizeEvent('info', FINALIZE_EVENTS.JOB_CREATED, {
          sourceRole: FINALIZE_SOURCE_ROLES.API,
          requestId: req.id ?? null,
          route: req.originalUrl,
          uid,
          sessionId,
          attemptId: key,
          stage: FINALIZE_STAGES.QUEUE_ENQUEUE,
          jobState: prepared.attempt?.state ?? 'queued',
          queuedAt: prepared.attempt?.enqueuedAt ?? null,
          estimatedSec: prepared.attempt?.usageReservation?.estimatedSec || null,
          reservedSec: prepared.attempt?.usageReservation?.reservedSec || null,
        });
        emitFinalizeEvent('info', FINALIZE_EVENTS.JOB_QUEUED, {
          sourceRole: FINALIZE_SOURCE_ROLES.API,
          requestId: req.id ?? null,
          route: req.originalUrl,
          uid,
          sessionId,
          attemptId: key,
          stage: FINALIZE_STAGES.QUEUE_ENQUEUE,
          jobState: prepared.attempt?.state ?? 'queued',
          queuedAt: prepared.attempt?.enqueuedAt ?? null,
          estimatedSec: prepared.attempt?.usageReservation?.estimatedSec || null,
          reservedSec: prepared.attempt?.usageReservation?.reservedSec || null,
        });
        void refreshFinalizeQueueMetrics().catch(() => {});
        logger.info('story.finalize.idempotency.enqueued', {
          routeStatus: `${req.method} ${req.originalUrl}`,
          sessionId,
          attemptId: key,
          estimatedSec: prepared.attempt?.usageReservation?.estimatedSec || null,
        });
      }

      const reply = await buildFinalizeHttpReply({
        req,
        uid,
        sessionId,
        getSession,
        prepared,
      });
      if (!reply) {
        return next(new Error('Finalize attempt reply was not generated.'));
      }

      req.finalizePrepared = prepared;
      req.finalizeReply = reply;
      next();
    } catch (err) {
      emitFinalizeEvent('error', FINALIZE_EVENTS.API_REJECTED, {
        sourceRole: FINALIZE_SOURCE_ROLES.API,
        requestId: req.id ?? null,
        route: req.originalUrl,
        uid,
        sessionId,
        attemptId: key,
        httpStatus: Number.isFinite(Number(err?.status)) ? Number(err.status) : 500,
        stage: FINALIZE_STAGES.ADMISSION_RESERVE_USAGE,
        durationMs: Date.now() - admissionStartedAt,
        error: err,
        ...describeFinalizeError(err, {
          retryable: false,
          failureReason: 'prepare_finalize_attempt_failed',
        }),
      });
      logger.error('story.finalize.idempotency.prepare_failed', {
        routeStatus: `${req.method} ${req.originalUrl}`,
        error: err,
      });
      return next(err);
    }
  };
}

export default function idempotencyFirestore({ ttlMinutes = 60 } = {}) {
  return async function middleware(req, res, next) {
    const key = req.get('X-Idempotency-Key');
    const uid = req.user?.uid || 'anon';
    if (!key)
      return fail(req, res, 400, 'MISSING_IDEMPOTENCY_KEY', 'Provide X-Idempotency-Key header.');

    const docRef = db.collection('idempotency').doc(`${uid}:${key}`);

    // Create "pending" if missing atomically
    try {
      await db.runTransaction(async (tx) => {
        const snap = await tx.get(docRef);
        if (snap.exists) {
          const d = snap.data();
          if (d.state === 'pending')
            throw Object.assign(new Error('IN_PROGRESS'), { _idemp: 'PENDING' });
          if (d.state === 'done') throw Object.assign(new Error('DONE'), { _idemp: d });
          // else fallthrough to rewrite state if needed
        } else {
          tx.set(docRef, {
            state: 'pending',
            createdAt: new Date(),
            expiresAt: new Date(Date.now() + ttlMinutes * 60 * 1000),
          });
        }
      });
    } catch (e) {
      if (e._idemp === 'PENDING')
        return fail(req, res, 409, 'IDEMPOTENT_IN_PROGRESS', 'Request in progress.');
      if (e._idemp) {
        const status = e._idemp.status || 200;
        const body = e._idemp.body;
        if (body != null && typeof body === 'object') {
          return res.status(status).json({ ...body, requestId: requestIdOf(req) });
        }
        return ok(req, res, body ?? null);
      }
      // else real error
      return next(e);
    }

    const origJson = res.json.bind(res);
    res.json = async (body) => {
      const status = res.statusCode || 200;
      try {
        if (status < 500) {
          await docRef.set(
            { state: 'done', status, body, finishedAt: new Date() },
            { merge: true }
          );
        } else {
          await docRef.delete().catch(() => {});
        }
      } catch {}
      return origJson(body);
    };

    res.on('finish', async () => {
      if (res.headersSent && res.statusCode >= 500) {
        try {
          await docRef.delete();
        } catch {}
      }
    });

    next();
  };
}
