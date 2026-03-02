import admin from '../config/firebase.js';
import { buildPublicUrl, getDownloadToken } from '../utils/storage.js';
import { ok, fail } from '../http/respond.js';

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
    return fail(req, res, 500, 'FETCH_FAILED', error?.message || 'FETCH_FAILED');
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

    const debug = req.query?.debug === '1';

    const destBase = `artifacts/${ownerUid}/${jobId}/`;
    const bucket = admin.storage().bucket();
    const bucketName = bucket.name;
    const fVideo = bucket.file(`${destBase}short.mp4`);
    const fCover = bucket.file(`${destBase}cover.jpg`);
    const fMeta = bucket.file(`${destBase}meta.json`);

    const diag = { bucket: bucketName, uid: ownerUid, jobId, base: destBase, steps: [] };

    let meta = null;
    try {
      const [buf] = await fMeta.download();
      meta = JSON.parse(buf.toString('utf8'));
      diag.steps.push('meta_download_ok');
    } catch (e) {
      diag.steps.push(`meta_missing:${e?.code || e?.message || e}`);
    }

    if (meta?.urls?.video) {
      const payload = {
        jobId,
        videoUrl: meta.urls.video,
        coverImageUrl: meta.urls.cover || null,
        durationSec: meta.durationSec ?? null,
        usedTemplate: meta.usedTemplate ?? null,
        usedQuote: meta.usedQuote ?? null,
        credits: meta.credits ?? null,
        createdAt: meta.createdAt ?? null,
      };
      if (debug) return ok(req, res, { source: 'meta.urls', diag, payload });
      return ok(req, res, payload);
    }

    const [existsVideo] = await fVideo.exists();
    if (!existsVideo) {
      if (debug) return fail(req, res, 200, 'NO_VIDEO_OBJECT', 'NO_VIDEO_OBJECT');
      return fail(req, res, 404, 'NOT_FOUND', 'NOT_FOUND');
    }
    const tokenVideo = await getDownloadToken(fVideo);
    const videoUrl = buildPublicUrl({
      bucket: bucketName,
      path: `${destBase}short.mp4`,
      token: tokenVideo,
    });

    const [existsCover] = await fCover.exists();
    let coverImageUrl = null;
    if (existsCover) {
      const tokenCover = await getDownloadToken(fCover);
      coverImageUrl = buildPublicUrl({
        bucket: bucketName,
        path: `${destBase}cover.jpg`,
        token: tokenCover,
      });
    }

    const payload = {
      jobId,
      videoUrl,
      coverImageUrl,
      durationSec: meta?.durationSec ?? null,
      usedTemplate: meta?.usedTemplate ?? null,
      usedQuote: meta?.usedQuote ?? null,
      credits: meta?.credits ?? null,
      createdAt: meta?.createdAt ?? null,
    };
    if (debug) return ok(req, res, { source: 'metadata.tokens', diag, payload });
    return ok(req, res, payload);
  } catch (e) {
    console.error('/shorts/:jobId error', e?.message || e);
    return fail(req, res, 500, 'GET_SHORT_FAILED', 'GET_SHORT_FAILED');
  }
}
