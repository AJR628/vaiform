import admin from '../config/firebase.js';
import { buildPublicUrl, getDownloadToken } from '../utils/storage.js';
import { ok, fail } from '../http/respond.js';
import { failInternalServerError } from '../http/internal-error.js';
import logger from '../observability/logger.js';
import { setRequestContextFromReq } from '../observability/request-context.js';
import {
  FINALIZE_EVENTS,
  FINALIZE_SOURCE_ROLES,
  FINALIZE_STAGES,
  emitFinalizeEvent,
} from '../observability/finalize-observability.js';

function readbackLagMsFromShortDoc(snapshot) {
  if (!snapshot?.exists) return null;
  const completedAt = snapshot.data()?.completedAt?.toDate?.();
  if (!(completedAt instanceof Date)) return null;
  return Math.max(0, Date.now() - completedAt.getTime());
}

export async function getMyShorts(req, res) {
  try {
    const ownerUid = req.user?.uid;
    if (!ownerUid) {
      return fail(req, res, 401, 'UNAUTHENTICATED', 'Login required');
    }

    const limit = Math.min(Number(req.query.limit) || 24, 100);
    const cursor = req.query.cursor;
    const db = admin.firestore();

    try {
      let query = db
        .collection('shorts')
        .where('ownerId', '==', ownerUid)
        .orderBy('createdAt', 'desc')
        .limit(limit);

      if (cursor) {
        query = query.startAfter(new Date(cursor));
      }

      const snapshot = await query.get();
      const items = snapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
        createdAt: doc.data().createdAt?.toDate?.() || null,
        completedAt: doc.data().completedAt?.toDate?.() || null,
        failedAt: doc.data().failedAt?.toDate?.() || null,
      }));

      const nextCursor = items.length > 0 ? items[items.length - 1].createdAt : null;

      console.log(
        `[shorts] PRIMARY path used for uid=${ownerUid}, loaded ${snapshot.docs.length} docs, limit=${limit}`
      );

      return ok(req, res, {
        items,
        nextCursor: nextCursor ? nextCursor.toISOString() : null,
        hasMore: items.length === limit,
      });
    } catch (err) {
      const needsIndex = err?.code === 9 || /requires an index/i.test(String(err?.message || ''));
      if (!needsIndex) {
        throw err;
      }

      console.warn('[shorts] Using index fallback for getMyShorts:', err.message);

      const snapshot = await db
        .collection('shorts')
        .where('ownerId', '==', ownerUid)
        .limit(1000)
        .get();

      const all = snapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
        createdAt: doc.data().createdAt?.toDate?.() || null,
        completedAt: doc.data().completedAt?.toDate?.() || null,
        failedAt: doc.data().failedAt?.toDate?.() || null,
      }));

      all.sort((a, b) => {
        if (!a.createdAt || !b.createdAt) return 0;
        return b.createdAt.getTime() - a.createdAt.getTime();
      });

      const items = all.slice(0, limit);

      console.log(
        `[shorts] FALLBACK path used for uid=${ownerUid}, loaded ${snapshot.docs.length} docs, returning ${items.length}, limit=${limit}`
      );

      return ok(req, res, {
        items,
        nextCursor: null,
        hasMore: false,
        note: 'INDEX_FALLBACK',
      });
    }
  } catch (error) {
    console.error('/shorts/mine error:', error);
    return failInternalServerError(req, res, 'FETCH_FAILED', 'Failed to fetch shorts');
  }
}

export async function getShortById(req, res) {
  try {
    const ownerUid = req.user?.uid;
    if (!ownerUid) {
      return fail(req, res, 401, 'UNAUTHENTICATED', 'Login required');
    }
    const jobId = String(req.params?.jobId || '').trim();
    if (!jobId) return fail(req, res, 400, 'INVALID_INPUT', 'jobId required');
    setRequestContextFromReq(req, { shortId: jobId });

    const debug = req.query?.debug === '1';

    const destBase = `artifacts/${ownerUid}/${jobId}/`;
    const bucket = admin.storage().bucket();
    const bucketName = bucket.name;
    const shortDocPromise = admin.firestore().collection('shorts').doc(jobId).get().catch(() => null);
    const storyVideoPath = `${destBase}story.mp4`;
    const legacyVideoPath = `${destBase}short.mp4`;
    const storyCoverPath = `${destBase}thumb.jpg`;
    const legacyCoverPath = `${destBase}cover.jpg`;
    const fStoryVideo = bucket.file(storyVideoPath);
    const fLegacyVideo = bucket.file(legacyVideoPath);
    const fStoryCover = bucket.file(storyCoverPath);
    const fLegacyCover = bucket.file(legacyCoverPath);
    const fMeta = bucket.file(`${destBase}meta.json`);

    const diag = { bucket: bucketName, uid: ownerUid, jobId, base: destBase, steps: [] };

    const buildPayload = ({ videoUrl, coverImageUrl, meta = null }) => ({
      id: jobId,
      jobId,
      videoUrl,
      coverImageUrl,
      durationSec: meta?.durationSec ?? null,
      usedTemplate: meta?.usedTemplate ?? null,
      usedQuote: meta?.usedQuote ?? null,
      createdAt: meta?.createdAt ?? null,
    });

    let meta = null;
    try {
      const [buf] = await fMeta.download();
      meta = JSON.parse(buf.toString('utf8'));
      diag.steps.push('meta_download_ok');
    } catch (e) {
      diag.steps.push(`meta_missing:${e?.code || e?.message || e}`);
    }

    if (meta?.urls?.video) {
      const shortDoc = await shortDocPromise;
      const finalizeAttemptId = shortDoc?.data?.()?.finalizeAttemptId || null;
      logger.info('shorts.detail.meta_hit', {
        routeStatus: `${req.method} ${req.originalUrl}`,
        shortId: jobId,
        hasCover: Boolean(meta.urls.cover),
      });
      emitFinalizeEvent('info', FINALIZE_EVENTS.READBACK_SHORT_DETAIL_READY, {
        sourceRole: FINALIZE_SOURCE_ROLES.API,
        requestId: req.id ?? null,
        route: req.originalUrl,
        uid: ownerUid,
        attemptId: finalizeAttemptId,
        shortId: jobId,
        stage: FINALIZE_STAGES.SHORT_DETAIL_READBACK,
        readbackLagMs: readbackLagMsFromShortDoc(shortDoc),
        surface: 'short_detail',
      });
      const payload = buildPayload({
        videoUrl: meta.urls.video,
        coverImageUrl: meta.urls.cover || null,
        meta,
      });
      if (debug) return ok(req, res, { source: 'meta.urls', diag, payload });
      return ok(req, res, payload);
    }

    let videoFile = null;
    let videoPath = null;
    const [storyVideoExists] = await fStoryVideo.exists();
    if (storyVideoExists) {
      videoFile = fStoryVideo;
      videoPath = storyVideoPath;
      diag.steps.push('video_story_exists');
    } else {
      const [legacyVideoExists] = await fLegacyVideo.exists();
      if (legacyVideoExists) {
        videoFile = fLegacyVideo;
        videoPath = legacyVideoPath;
        diag.steps.push('video_legacy_exists');
      }
    }

    if (!videoFile || !videoPath) {
      const shortDoc = await shortDocPromise;
      const finalizeAttemptId = shortDoc?.data?.()?.finalizeAttemptId || null;
      logger.warn('shorts.detail.not_found', {
        routeStatus: `${req.method} ${req.originalUrl}`,
        shortId: jobId,
        debug,
      });
      emitFinalizeEvent('warn', FINALIZE_EVENTS.READBACK_SHORT_DETAIL_PENDING, {
        sourceRole: FINALIZE_SOURCE_ROLES.API,
        requestId: req.id ?? null,
        route: req.originalUrl,
        uid: ownerUid,
        attemptId: finalizeAttemptId,
        shortId: jobId,
        stage: FINALIZE_STAGES.SHORT_DETAIL_READBACK,
        httpStatus: 404,
        surface: 'short_detail',
      });
      if (debug) return fail(req, res, 200, 'NO_VIDEO_OBJECT', 'NO_VIDEO_OBJECT');
      return fail(req, res, 404, 'NOT_FOUND', 'NOT_FOUND');
    }

    const tokenVideo = await getDownloadToken(videoFile);
    const videoUrl = buildPublicUrl({
      bucket: bucketName,
      path: videoPath,
      token: tokenVideo,
    });

    let coverImageUrl = null;
    let coverPath = null;
    const [storyCoverExists] = await fStoryCover.exists();
    if (storyCoverExists) {
      coverPath = storyCoverPath;
      diag.steps.push('cover_story_exists');
    } else {
      const [legacyCoverExists] = await fLegacyCover.exists();
      if (legacyCoverExists) {
        coverPath = legacyCoverPath;
        diag.steps.push('cover_legacy_exists');
      }
    }

    if (coverPath) {
      const coverFile = coverPath === storyCoverPath ? fStoryCover : fLegacyCover;
      const tokenCover = await getDownloadToken(coverFile);
      coverImageUrl = buildPublicUrl({
        bucket: bucketName,
        path: coverPath,
        token: tokenCover,
      });
    }

    const payload = buildPayload({
      videoUrl,
      coverImageUrl,
      meta,
    });
    const shortDoc = await shortDocPromise;
    const finalizeAttemptId = shortDoc?.data?.()?.finalizeAttemptId || null;
    logger.info('shorts.detail.storage_hit', {
      routeStatus: `${req.method} ${req.originalUrl}`,
      shortId: jobId,
      videoSource: videoPath === storyVideoPath ? 'story' : 'legacy',
      coverSource: coverPath === storyCoverPath ? 'story' : coverPath === legacyCoverPath ? 'legacy' : null,
      hasMeta: Boolean(meta),
    });
    emitFinalizeEvent('info', FINALIZE_EVENTS.READBACK_SHORT_DETAIL_READY, {
      sourceRole: FINALIZE_SOURCE_ROLES.API,
      requestId: req.id ?? null,
      route: req.originalUrl,
      uid: ownerUid,
      attemptId: finalizeAttemptId,
      shortId: jobId,
      stage: FINALIZE_STAGES.SHORT_DETAIL_READBACK,
      readbackLagMs: readbackLagMsFromShortDoc(shortDoc),
      surface: 'short_detail',
    });
    if (debug) return ok(req, res, { source: 'storage.tokens', diag, payload });
    return ok(req, res, payload);
  } catch (e) {
    logger.error('shorts.detail.failed', {
      routeStatus: `${req.method} ${req.originalUrl}`,
      shortId: String(req.params?.jobId || '').trim() || null,
      error: e,
    });
    return fail(req, res, 500, 'GET_SHORT_FAILED', 'GET_SHORT_FAILED');
  }
}
