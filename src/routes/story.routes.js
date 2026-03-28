import { Router } from 'express';
import { z } from 'zod';
import requireAuth from '../middleware/requireAuth.js';
import { enforceRenderTimeForRender, enforceScriptDailyCap } from '../middleware/planGuards.js';
import { idempotencyFinalize } from '../middleware/idempotency.firestore.js';
import { withRenderSlot } from '../utils/render.semaphore.js';
import {
  createStorySession,
  getStorySession,
  generateStory,
  createManualStorySession,
  updateStorySentences,
  planShots,
  searchShots,
  searchClipsForShot,
  updateShotSelectedClip,
  updateVideoCuts,
  insertBeatWithSearch,
  deleteBeat,
  updateBeatText,
  buildTimeline,
  generateCaptionTimings,
  renderStory,
  saveStorySession,
  refreshStorySessionHeuristicEstimate,
  sanitizeStorySessionForClient,
} from '../services/story.service.js';
import { extractStyleOnly } from '../utils/caption-style-helper.js';
import { ok, fail } from '../http/respond.js';
import { isOutboundPolicyError } from '../utils/outbound.fetch.js';
import logger from '../observability/logger.js';
import { setRequestContextFromReq } from '../observability/request-context.js';
import {
  FINALIZE_EVENTS,
  FINALIZE_SOURCE_ROLES,
  FINALIZE_STAGES,
  describeFinalizeError,
  emitFinalizeEvent,
} from '../observability/finalize-observability.js';

const r = Router();
r.use(requireAuth);

const requestIdOf = (req) => req?.id ?? null;
const presentStorySession = (session) => sanitizeStorySessionForClient(session);
const okStorySession = (req, res, session) => ok(req, res, presentStorySession(session));
const zodFields = (error) => {
  const fields = {};
  for (const issue of error?.issues || []) {
    const key = issue?.path?.length ? issue.path.join('.') : '_root';
    // Keep the first message per path for deterministic, string-only fields.
    if (!(key in fields)) fields[key] = issue.message;
  }
  return fields;
};

const serverBusyFailure = (
  req,
  retryAfter = 30,
  detail = 'Server is busy. Please retry shortly.'
) => ({
  success: false,
  error: 'SERVER_BUSY',
  detail,
  requestId: requestIdOf(req),
  retryAfter,
});

const sendMappedStoryFailure = (req, res, mapped) => {
  if (mapped?.status === 503) {
    const retryAfter = mapped.retryAfter || 15;
    res.set('Retry-After', String(retryAfter));
    return res.status(503).json(serverBusyFailure(req, retryAfter, mapped.detail));
  }
  return fail(req, res, mapped.status, mapped.error, mapped.detail);
};

function phase2StoryFailureFromError(error) {
  const rawCode = typeof error?.code === 'string' ? error.code : null;
  const rawMessage = typeof error?.message === 'string' ? error.message : null;

  if (rawCode === 'SESSION_NOT_FOUND' || rawMessage === 'SESSION_NOT_FOUND') {
    return { status: 404, error: 'SESSION_NOT_FOUND', detail: 'Session not found' };
  }
  if (rawCode === 'PLAN_REQUIRED' || rawMessage === 'PLAN_REQUIRED') {
    return {
      status: 400,
      error: 'PLAN_REQUIRED',
      detail: 'Story plan required before clip search',
    };
  }
  if (rawCode === 'STORY_REQUIRED' || rawMessage === 'STORY_REQUIRED') {
    return { status: 400, error: 'STORY_REQUIRED', detail: 'Story required' };
  }
  if (rawCode === 'SHOTS_REQUIRED' || rawMessage === 'SHOTS_REQUIRED') {
    return { status: 400, error: 'SHOTS_REQUIRED', detail: 'Shots required' };
  }
  if (rawCode === 'INVALID_SENTENCE_INDEX' || rawMessage === 'INVALID_SENTENCE_INDEX') {
    return {
      status: 400,
      error: 'INVALID_SENTENCE_INDEX',
      detail: 'Sentence index out of range',
    };
  }
  if (rawCode === 'SHOT_NOT_FOUND' || rawMessage === 'SHOT_NOT_FOUND') {
    return { status: 404, error: 'SHOT_NOT_FOUND', detail: 'Shot not found' };
  }
  if (typeof rawMessage === 'string' && rawMessage.startsWith('SHOT_NOT_FOUND:')) {
    return {
      status: 404,
      error: 'SHOT_NOT_FOUND',
      detail: `Shot not found (${rawMessage.slice('SHOT_NOT_FOUND:'.length).trim()})`,
    };
  }
  if (rawCode === 'NO_SEARCH_QUERY_AVAILABLE' || rawMessage === 'NO_SEARCH_QUERY_AVAILABLE') {
    return {
      status: 400,
      error: 'NO_SEARCH_QUERY_AVAILABLE',
      detail: 'Search query required',
    };
  }
  if (rawCode === 'NO_CANDIDATES_AVAILABLE' || rawMessage === 'NO_CANDIDATES_AVAILABLE') {
    return {
      status: 400,
      error: 'NO_CANDIDATES_AVAILABLE',
      detail: 'No candidates available for shot',
    };
  }
  if (rawCode === 'CLIP_NOT_FOUND_IN_CANDIDATES' || rawMessage === 'CLIP_NOT_FOUND_IN_CANDIDATES') {
    return {
      status: 400,
      error: 'CLIP_NOT_FOUND_IN_CANDIDATES',
      detail: 'Clip not found in current candidates',
    };
  }

  return null;
}

function storyFailureFromError(error) {
  if (isOutboundPolicyError(error)) {
    return {
      status: error?.status || 400,
      error: error?.code || 'OUTBOUND_URL_REJECTED',
      detail: error?.message || 'Outbound URL rejected',
    };
  }

  switch (error?.code) {
    case 'LINK_EXTRACT_TOO_LARGE':
    case 'VIDEO_SIZE':
    case 'VIDEO_TYPE':
      return {
        status: error?.status || 400,
        error: error.code,
        detail: error?.message || 'Invalid outbound media',
      };
    case 'LINK_EXTRACT_TIMEOUT':
    case 'VIDEO_DOWNLOAD_TIMEOUT':
      return {
        status: 504,
        error: error.code,
        detail: error?.message || 'Outbound fetch timed out',
      };
    case 'VIDEO_FETCH_BODY_MISSING':
      return {
        status: error?.status || 502,
        error: error.code,
        detail: error?.message || 'Remote video fetch failed',
      };
    case 'STORY_GENERATE_BUSY':
    case 'STORY_GENERATE_TIMEOUT':
    case 'STORY_PLAN_BUSY':
    case 'STORY_PLAN_TIMEOUT':
    case 'STORY_SEARCH_BUSY':
    case 'STORY_SEARCH_TEMPORARILY_UNAVAILABLE':
      return {
        status: 503,
        error: 'SERVER_BUSY',
        detail: error?.message || 'Server is busy. Please retry shortly.',
        retryAfter: error?.retryAfter || 15,
      };
    default:
      if (typeof error?.code === 'string' && error.code.startsWith('VIDEO_FETCH_')) {
        return {
          status: error?.status || 502,
          error: error.code,
          detail: error?.message || 'Remote video fetch failed',
        };
      }
      return phase2StoryFailureFromError(error);
  }
}
const StartSchema = z.object({
  input: z.string().min(1).max(2000),
  inputType: z.enum(['link', 'idea', 'paragraph']).default('paragraph'),
  styleKey: z.enum(['default', 'hype', 'cozy']).optional().default('default'),
});

const SessionSchema = z.object({
  sessionId: z.string().min(3),
});

const GenerateSchema = z.object({
  sessionId: z.string().min(3),
  input: z.string().min(1).max(2000).optional(),
  inputType: z.enum(['link', 'idea', 'paragraph']).optional(),
});

// POST /api/story/start - Create session, accept input
r.post('/start', async (req, res) => {
  try {
    const parsed = StartSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return fail(req, res, 400, 'INVALID_INPUT', 'Invalid request', zodFields(parsed.error));
    }

    const { input, inputType, styleKey } = parsed.data;
    const session = await createStorySession({
      uid: req.user.uid,
      input,
      inputType,
      styleKey,
    });

    return okStorySession(req, res, session);
  } catch (e) {
    console.error('[story][start] error:', e);
    return fail(
      req,
      res,
      500,
      'STORY_START_FAILED',
      e?.message || 'Failed to create story session'
    );
  }
});

// POST /api/story/generate - Generate story from input
r.post('/generate', enforceScriptDailyCap(300), async (req, res) => {
  try {
    const parsed = GenerateSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return fail(req, res, 400, 'INVALID_INPUT', 'Invalid request', zodFields(parsed.error));
    }

    const { sessionId, input, inputType } = parsed.data;
    setRequestContextFromReq(req, { sessionId });
    logger.info('story.generate.request', {
      routeStatus: `${req.method} ${req.originalUrl}`,
      inputType,
    });
    const session = await generateStory({
      uid: req.user.uid,
      sessionId,
      input,
      inputType,
    });

    return okStorySession(req, res, session);
  } catch (e) {
    const mapped = storyFailureFromError(e);
    logger.error('story.generate.failed', {
      routeStatus: `${req.method} ${req.originalUrl}`,
      mappedStatus: mapped?.status,
      mappedError: mapped?.error,
      error: e,
    });
    if (mapped) {
      return sendMappedStoryFailure(req, res, mapped);
    }
    return fail(req, res, 500, 'STORY_GENERATE_FAILED', e?.message || 'Failed to generate story');
  }
});

// POST /api/story/update-script - Update story sentences (when user edits script)
r.post('/update-script', async (req, res) => {
  try {
    const UpdateScriptSchema = z.object({
      sessionId: z.string().min(3),
      sentences: z.array(z.string().min(1)).min(1),
    });

    const parsed = UpdateScriptSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return fail(req, res, 400, 'INVALID_INPUT', 'Invalid request', zodFields(parsed.error));
    }

    const { sessionId, sentences } = parsed.data;
    const session = await updateStorySentences({
      uid: req.user.uid,
      sessionId,
      sentences,
    });

    return okStorySession(req, res, session);
  } catch (e) {
    console.error('[story][update-script] error:', e);
    return fail(
      req,
      res,
      500,
      'STORY_UPDATE_SCRIPT_FAILED',
      e?.message || 'Failed to update story script'
    );
  }
});

// POST /api/story/update-caption-style - Update caption style for session
r.post('/update-caption-style', async (req, res) => {
  try {
    const CaptionStyleSchema = z
      .object({
        // Typography
        fontFamily: z.string().optional(),
        fontPx: z.number().min(8).max(400).optional(),
        weightCss: z
          .enum(['normal', 'bold', '100', '200', '300', '400', '500', '600', '700', '800', '900'])
          .optional(),
        fontStyle: z.enum(['normal', 'italic']).optional(),
        letterSpacingPx: z.number().optional(),
        lineSpacingPx: z.number().optional(),

        // Color & Effects
        color: z.string().optional(),
        opacity: z.number().min(0).max(1).optional(),
        strokePx: z.number().min(0).optional(),
        strokeColor: z.string().optional(),
        shadowBlur: z.number().min(0).optional(),
        shadowOffsetX: z.number().optional(),
        shadowOffsetY: z.number().optional(),
        shadowColor: z.string().optional(),

        // Placement
        placement: z.enum(['top', 'center', 'bottom', 'custom']).optional(),
        yPct: z.number().min(0).max(1).optional(),
        xPct: z.number().min(0).max(1).optional(),
        wPct: z.number().min(0).max(1).optional(),
      })
      .strict(); // Reject unknown fields (mode, lines, rasterUrl, etc.)

    const parsed = z
      .object({
        sessionId: z.string().min(3),
        overlayCaption: CaptionStyleSchema,
      })
      .safeParse(req.body || {});

    if (!parsed.success) {
      return fail(req, res, 400, 'INVALID_INPUT', 'Invalid request', zodFields(parsed.error));
    }

    const { sessionId, overlayCaption } = parsed.data;
    const session = await getStorySession({
      uid: req.user.uid,
      sessionId,
    });

    if (!session) {
      return fail(req, res, 404, 'SESSION_NOT_FOUND', 'Session not found');
    }

    // Merge style into session (extract style-only from existing if present)
    const existing = session.overlayCaption || {};
    const existingStyleOnly = extractStyleOnly(existing);
    const mergedStyle = { ...existingStyleOnly, ...overlayCaption };

    // Strip any dangerous fields that might exist (defensive)
    session.overlayCaption = extractStyleOnly(mergedStyle);
    session.updatedAt = new Date().toISOString();

    await saveStorySession({ uid: req.user.uid, sessionId, data: session });

    return ok(req, res, { overlayCaption: session.overlayCaption });
  } catch (e) {
    console.error('[story][update-caption-style] error:', e);
    return fail(
      req,
      res,
      500,
      'STORY_UPDATE_CAPTION_STYLE_FAILED',
      e?.message || 'Failed to update caption style'
    );
  }
});

// POST /api/story/update-caption-meta - Save captionMeta for session
// Supports both single-beat (legacy) and batch mode (new)
r.post('/update-caption-meta', requireAuth, async (req, res) => {
  try {
    // Detect batch vs single mode
    const isBatchMode = Array.isArray(req.body?.updates);

    // Schema for single-beat mode (legacy)
    const SingleBeatSchema = z.object({
      sessionId: z.string().min(3),
      beatIndex: z.number().int().min(0),
      captionMeta: z.object({
        lines: z.array(z.string()).min(1).max(20),
        effectiveStyle: z.object({}).passthrough(),
        styleHash: z.string().optional(),
        wrapHash: z.string().optional(),
        maxWidthPx: z.number().min(0).max(2000),
        totalTextH: z.number().min(0).max(5000),
      }),
    });

    // Schema for batch mode (new)
    const BatchSchema = z.object({
      sessionId: z.string().min(3),
      updates: z
        .array(
          z.object({
            beatIndex: z.number().int().min(0),
            captionMeta: z.object({
              lines: z.array(z.string()).min(1).max(20),
              effectiveStyle: z.object({}).passthrough(),
              styleHash: z.string().optional(),
              wrapHash: z.string().optional(),
              maxWidthPx: z.number().min(0).max(2000),
              totalTextH: z.number().min(0).max(5000),
            }),
          })
        )
        .min(1)
        .max(20), // Hard cap batch size <= 20
    });

    // Parse based on mode
    const parsed = isBatchMode
      ? BatchSchema.safeParse(req.body)
      : SingleBeatSchema.safeParse(req.body);

    if (!parsed.success) {
      return fail(req, res, 400, 'INVALID_INPUT', 'Invalid request', zodFields(parsed.error));
    }

    const { sessionId } = parsed.data;

    // Load session once (shared for both modes)
    const session = await getStorySession({ uid: req.user.uid, sessionId });

    if (!session) {
      return fail(req, res, 404, 'SESSION_NOT_FOUND', 'Session not found');
    }

    const sentences = session.story?.sentences || [];

    // Import dependencies once (shared)
    const { compileCaptionSSOT } = await import('../captions/compile.js');
    const cryptoModule = await import('crypto');

    // Helper to process a single beat update
    const processBeatUpdate = (beatIndex, clientMeta) => {
      if (beatIndex < 0 || beatIndex >= sentences.length) {
        return {
          beatIndex,
          error: 'INVALID_BEAT_INDEX',
          detail: `beatIndex ${beatIndex} out of range (0-${sentences.length - 1})`,
        };
      }

      const textRaw = sentences[beatIndex];
      const sanitizedStyle = extractStyleOnly(clientMeta.effectiveStyle || {});

      const recomputedMeta = compileCaptionSSOT({
        textRaw,
        style: sanitizedStyle,
        frameW: 1080,
        frameH: 1920,
      });

      // Verify lines match compiler output
      const linesMatch =
        recomputedMeta.lines.length === clientMeta.lines.length &&
        recomputedMeta.lines.every((line, i) => line === clientMeta.lines[i]);

      if (!linesMatch) {
        console.warn('[update-caption-meta] Lines mismatch (skipping beat):', {
          beatIndex,
          clientLinesCount: clientMeta.lines.length,
          serverLinesCount: recomputedMeta.lines.length,
          textRaw: textRaw.substring(0, 50) + '...',
        });
        return { beatIndex, error: 'STALE_META', skipped: true };
      }

      const textHash = cryptoModule
        .createHash('sha256')
        .update(textRaw.trim().toLowerCase())
        .digest('hex')
        .slice(0, 16);

      const serverMeta = {
        lines: recomputedMeta.lines,
        effectiveStyle: recomputedMeta.effectiveStyle,
        styleHash: recomputedMeta.styleHash,
        wrapHash: recomputedMeta.wrapHash,
        textHash: textHash,
        maxWidthPx: recomputedMeta.maxWidthPx,
        totalTextH: recomputedMeta.totalTextH,
      };

      // Store per-beat meta
      if (!session.beats) session.beats = [];
      if (!session.beats[beatIndex]) session.beats[beatIndex] = {};
      session.beats[beatIndex].captionMeta = serverMeta;

      return { beatIndex, captionMeta: serverMeta };
    };

    if (isBatchMode) {
      // BATCH MODE: Process all updates, save once
      const updates = parsed.data.updates;
      const results = [];

      for (const { beatIndex, captionMeta } of updates) {
        const result = processBeatUpdate(beatIndex, captionMeta);
        if (!result.skipped && !result.error) {
          results.push(result);
        }
      }

      // Only save if we have successful updates (avoid pointless writes)
      if (results.length > 0) {
        session.updatedAt = new Date().toISOString();
        await saveStorySession({ uid: req.user.uid, sessionId, data: session });
        console.log('[update-caption-meta] Saved', {
          mode: 'batch',
          count: results.length,
          sessionId,
        });
      } else {
        console.log('[update-caption-meta] No updates to save (all skipped)', {
          mode: 'batch',
          sessionId,
        });
      }

      return ok(req, res, { updates: results });
    } else {
      // SINGLE MODE: Legacy behavior (backwards compatible)
      const { beatIndex, captionMeta: clientMeta } = parsed.data;
      const result = processBeatUpdate(beatIndex, clientMeta);

      if (result.error === 'INVALID_BEAT_INDEX') {
        return fail(req, res, 400, result.error, result.detail);
      }

      if (result.error === 'STALE_META') {
        return fail(
          req,
          res,
          409,
          'STALE_META',
          'Caption meta lines do not match server computation. Preview may be stale. Please regenerate preview.'
        );
      }

      session.updatedAt = new Date().toISOString();
      await saveStorySession({ uid: req.user.uid, sessionId, data: session });
      console.log('[update-caption-meta] Saved', { mode: 'single', beatIndex, sessionId });

      return ok(req, res, { captionMeta: result.captionMeta });
    }
  } catch (e) {
    console.error('[story][update-caption-meta] error:', e);
    return fail(
      req,
      res,
      500,
      'UPDATE_CAPTION_META_FAILED',
      e?.message || 'Failed to update caption meta'
    );
  }
});

// POST /api/story/plan - Generate visual plan
r.post('/plan', enforceScriptDailyCap(300), async (req, res) => {
  try {
    const parsed = SessionSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return fail(req, res, 400, 'INVALID_INPUT', 'Invalid request', zodFields(parsed.error));
    }

    const { sessionId } = parsed.data;
    const session = await planShots({
      uid: req.user.uid,
      sessionId,
    });

    return okStorySession(req, res, session);
  } catch (e) {
    const mapped = storyFailureFromError(e);
    logger.error('story.plan.failed', {
      routeStatus: `${req.method} ${req.originalUrl}`,
      mappedStatus: mapped?.status,
      mappedError: mapped?.error,
      error: e,
    });
    if (mapped) {
      return sendMappedStoryFailure(req, res, mapped);
    }
    return fail(req, res, 500, 'STORY_PLAN_FAILED', e?.message || 'Failed to plan shots');
  }
});

// POST /api/story/search - Search and select clips (Phase 3)
r.post('/search', async (req, res) => {
  try {
    const parsed = SessionSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return fail(req, res, 400, 'INVALID_INPUT', 'Invalid request', zodFields(parsed.error));
    }

    const { sessionId } = parsed.data;
    setRequestContextFromReq(req, { sessionId });
    logger.info('story.search.request', {
      routeStatus: `${req.method} ${req.originalUrl}`,
    });
    const session = await searchShots({
      uid: req.user.uid,
      sessionId,
    });

    return okStorySession(req, res, session);
  } catch (e) {
    const mapped = storyFailureFromError(e);
    logger.error('story.search.failed', {
      routeStatus: `${req.method} ${req.originalUrl}`,
      mappedStatus: mapped?.status,
      mappedError: mapped?.error,
      error: e,
    });
    if (mapped) {
      return sendMappedStoryFailure(req, res, mapped);
    }
    return fail(req, res, 500, 'STORY_SEARCH_FAILED', e?.message || 'Failed to search clips');
  }
});

// POST /api/story/update-shot - Update selected clip for a shot (Phase 2 - Clip Swap)
r.post('/update-shot', async (req, res) => {
  try {
    const UpdateShotSchema = z.object({
      sessionId: z.string().min(3),
      sentenceIndex: z.number().int().min(0),
      clipId: z.string().min(1),
    });

    const parsed = UpdateShotSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return fail(req, res, 400, 'INVALID_INPUT', 'Invalid request', zodFields(parsed.error));
    }

    const { sessionId, sentenceIndex, clipId } = parsed.data;
    const result = await updateShotSelectedClip({
      uid: req.user.uid,
      sessionId,
      sentenceIndex,
      clipId,
    });

    return ok(req, res, result);
  } catch (e) {
    const mapped = storyFailureFromError(e);
    if (mapped) {
      return fail(req, res, mapped.status, mapped.error, mapped.detail);
    }
    console.error('[story][update-shot] error:', e);
    return fail(req, res, 500, 'STORY_UPDATE_SHOT_FAILED', e?.message || 'Failed to update shot');
  }
});

// Zod schema for videoCutsV1 (version 1, boundaries validated against N in service)
const VideoCutsBoundarySchema = z.object({
  leftBeat: z.number().int().min(0),
  pos: z.object({
    beatIndex: z.number().int().min(0),
    pct: z.number().min(0).max(1),
  }),
});
const UpdateVideoCutsSchema = z.object({
  sessionId: z.string().min(3),
  videoCutsV1: z.object({
    version: z.literal(1),
    boundaries: z.array(VideoCutsBoundarySchema),
  }),
});

// POST /api/story/update-video-cuts - Persist beat-space video cuts (videoCutsV1)
r.post('/update-video-cuts', async (req, res) => {
  try {
    const parsed = UpdateVideoCutsSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return fail(req, res, 400, 'INVALID_INPUT', 'Invalid request', zodFields(parsed.error));
    }
    const { sessionId, videoCutsV1 } = parsed.data;
    const session = await updateVideoCuts({
      uid: req.user.uid,
      sessionId,
      videoCutsV1,
    });
    return okStorySession(req, res, session);
  } catch (e) {
    console.error('[story][update-video-cuts] error:', e);
    const status = e?.message === 'SESSION_NOT_FOUND' ? 404 : 400;
    return fail(
      req,
      res,
      status,
      e?.message?.startsWith('INVALID_') ||
        e?.message === 'SESSION_NOT_FOUND' ||
        e?.message === 'STORY_REQUIRED'
        ? e.message
        : 'STORY_UPDATE_VIDEO_CUTS_FAILED',
      e?.message || 'Failed to update video cuts'
    );
  }
});

// POST /api/story/search-shot - Search clips for a single shot (Phase 3 - Clip Search)
r.post('/search-shot', async (req, res) => {
  try {
    const SearchShotSchema = z.object({
      sessionId: z.string().min(3),
      sentenceIndex: z.number().int().min(0),
      query: z.string().optional(),
      page: z.number().int().min(1).optional(),
    });

    const parsed = SearchShotSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return fail(req, res, 400, 'INVALID_INPUT', 'Invalid request', zodFields(parsed.error));
    }

    const { sessionId, sentenceIndex, query, page = 1 } = parsed.data;
    setRequestContextFromReq(req, { sessionId });
    logger.info('story.search_shot.request', {
      routeStatus: `${req.method} ${req.originalUrl}`,
      sentenceIndex,
      hasQuery: Boolean(query?.trim()),
      page,
    });
    const result = await searchClipsForShot({
      uid: req.user.uid,
      sessionId,
      sentenceIndex,
      query,
      page,
    });

    return ok(req, res, {
      shot: result.shot,
      page: result.page,
      hasMore: result.hasMore,
    });
  } catch (e) {
    const mapped = storyFailureFromError(e);
    logger.error('story.search_shot.failed', {
      routeStatus: `${req.method} ${req.originalUrl}`,
      mappedStatus: mapped?.status,
      mappedError: mapped?.error,
      error: e,
    });
    if (mapped) {
      return sendMappedStoryFailure(req, res, mapped);
    }
    return fail(
      req,
      res,
      500,
      'STORY_SEARCH_SHOT_FAILED',
      e?.message || 'Failed to search clips for shot'
    );
  }
});

// POST /api/story/insert-beat - Insert a new beat with automatic clip search
r.post('/insert-beat', async (req, res) => {
  try {
    const InsertBeatSchema = z.object({
      sessionId: z.string().min(3),
      insertAfterIndex: z.number().int().min(-1),
      text: z.string().min(1),
    });

    const parsed = InsertBeatSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return fail(req, res, 400, 'INVALID_INPUT', 'Invalid request', zodFields(parsed.error));
    }

    const { sessionId, insertAfterIndex, text } = parsed.data;
    const result = await insertBeatWithSearch({
      uid: req.user.uid,
      sessionId,
      insertAfterIndex,
      text,
    });

    return ok(req, res, result);
  } catch (e) {
    console.error('[story][insert-beat] error:', e);
    return fail(req, res, 500, 'STORY_INSERT_BEAT_FAILED', e?.message || 'Failed to insert beat');
  }
});

// POST /api/story/delete-beat - Delete a beat (sentence + shot)
r.post('/delete-beat', async (req, res) => {
  try {
    const DeleteBeatSchema = z.object({
      sessionId: z.string().min(3),
      sentenceIndex: z.number().int().min(0),
    });

    const parsed = DeleteBeatSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return fail(req, res, 400, 'INVALID_INPUT', 'Invalid request', zodFields(parsed.error));
    }

    const { sessionId, sentenceIndex } = parsed.data;
    const result = await deleteBeat({
      uid: req.user.uid,
      sessionId,
      sentenceIndex,
    });

    return ok(req, res, result);
  } catch (e) {
    const mapped = storyFailureFromError(e);
    if (mapped) {
      return fail(req, res, mapped.status, mapped.error, mapped.detail);
    }
    console.error('[story][delete-beat] error:', e);
    return fail(req, res, 500, 'STORY_DELETE_BEAT_FAILED', e?.message || 'Failed to delete beat');
  }
});

// POST /api/story/update-beat-text - Update beat text
const UpdateBeatTextSchema = z.object({
  sessionId: z.string().min(3),
  sentenceIndex: z.number().int().min(0),
  text: z.string().min(1),
});

r.post('/update-beat-text', async (req, res) => {
  try {
    const parsed = UpdateBeatTextSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return fail(req, res, 400, 'INVALID_INPUT', 'Invalid request', zodFields(parsed.error));
    }
    const { sessionId, sentenceIndex, text } = parsed.data;
    const uid = req.user.uid;

    const { sentences, shots } = await updateBeatText({
      uid,
      sessionId,
      sentenceIndex,
      text,
    });

    return ok(req, res, { sentences, shots });
  } catch (e) {
    const mapped = storyFailureFromError(e);
    if (mapped) {
      return fail(req, res, mapped.status, mapped.error, mapped.detail);
    }
    console.error('[story][update-beat-text] error:', e);
    return fail(
      req,
      res,
      500,
      'STORY_UPDATE_BEAT_TEXT_FAILED',
      e?.message || 'Failed to update beat text'
    );
  }
});

// POST /api/story/timeline - Build stitched video (Phase 4)
r.post('/timeline', async (req, res) => {
  try {
    const parsed = SessionSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return fail(req, res, 400, 'INVALID_INPUT', 'Invalid request', zodFields(parsed.error));
    }

    const { sessionId } = parsed.data;
    const session = await buildTimeline({
      uid: req.user.uid,
      sessionId,
    });

    return okStorySession(req, res, session);
  } catch (e) {
    console.error('[story][timeline] error:', e);
    return fail(req, res, 500, 'STORY_TIMELINE_FAILED', e?.message || 'Failed to build timeline');
  }
});

// POST /api/story/captions - Generate caption timings (Phase 5)
r.post('/captions', async (req, res) => {
  try {
    const parsed = SessionSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return fail(req, res, 400, 'INVALID_INPUT', 'Invalid request', zodFields(parsed.error));
    }

    const { sessionId } = parsed.data;
    const session = await generateCaptionTimings({
      uid: req.user.uid,
      sessionId,
    });

    return okStorySession(req, res, session);
  } catch (e) {
    console.error('[story][captions] error:', e);
    return fail(
      req,
      res,
      500,
      'STORY_CAPTIONS_FAILED',
      e?.message || 'Failed to generate caption timings'
    );
  }
});

// POST /api/story/render - Render final video (Phase 6)
// When DISABLE_STORY_RENDER_ROUTE=1, returns 405 and directs clients to POST /api/story/finalize.
r.post(
  '/render',
  (req, res, next) => {
    if (process.env.DISABLE_STORY_RENDER_ROUTE === '1') {
      return fail(req, res, 405, 'RENDER_DISABLED', 'Use POST /api/story/finalize');
    }
    next();
  },
  enforceRenderTimeForRender(getStorySession),
  async (req, res) => {
    try {
      const parsed = SessionSchema.safeParse(req.body || {});
      if (!parsed.success) {
        return fail(req, res, 400, 'INVALID_INPUT', 'Invalid request', zodFields(parsed.error));
      }

      const { sessionId } = parsed.data;
      const session = await withRenderSlot(() =>
        renderStory({
          uid: req.user.uid,
          sessionId,
        })
      );

      return okStorySession(req, res, session);
    } catch (e) {
      if (res.headersSent) return;
      if (e?.code === 'SERVER_BUSY' || e?.message === 'SERVER_BUSY') {
        res.set('Retry-After', '30');
        return res.status(503).json(serverBusyFailure(req, 30));
      }
      const mapped = storyFailureFromError(e);
      if (mapped) {
        return fail(req, res, mapped.status, mapped.error, mapped.detail);
      }
      console.error('[story][render] error:', e);
      return fail(req, res, 500, 'STORY_RENDER_FAILED', e?.message || 'Failed to render story');
    }
  }
);

// POST /api/story/finalize - Reserve, enqueue, and return accepted finalize state.
r.post('/finalize', idempotencyFinalize({ getSession: getStorySession }), async (req, res) => {
  try {
    const parsed = SessionSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return fail(req, res, 400, 'INVALID_INPUT', 'Invalid request', zodFields(parsed.error));
    }

    const { sessionId } = parsed.data;
    const attemptId = String(req.get('X-Idempotency-Key') || '').trim();
    setRequestContextFromReq(req, { sessionId, attemptId });
    logger.info('story.finalize.request', {
      routeStatus: `${req.method} ${req.originalUrl}`,
    });

    const reply = req.finalizeReply;
    if (!reply) {
      throw new Error('Finalize reply was not prepared by idempotency middleware');
    }

    if (req.finalizePrepared?.kind === 'enqueued') {
      emitFinalizeEvent('info', FINALIZE_EVENTS.API_ACCEPTED, {
        sourceRole: FINALIZE_SOURCE_ROLES.API,
        requestId: req.id ?? null,
        route: req.originalUrl,
        uid: req.user?.uid ?? null,
        sessionId,
        attemptId,
        finalizeJobId: req.finalizePrepared?.attempt?.jobId ?? attemptId,
        executionAttemptId: req.finalizePrepared?.attempt?.executionAttemptId ?? null,
        httpStatus: reply.status,
        stage: FINALIZE_STAGES.QUEUE_ENQUEUE,
        jobState: req.finalizePrepared?.attempt?.jobState ?? req.finalizePrepared?.attempt?.state ?? 'queued',
        queuedAt: req.finalizePrepared?.attempt?.enqueuedAt ?? null,
        durationMs:
          Number.isFinite(Number(req.finalizeAdmissionStartedAt))
            ? Date.now() - Number(req.finalizeAdmissionStartedAt)
            : null,
      });
      logger.info('story.finalize.accepted', {
        routeStatus: `${req.method} ${req.originalUrl}`,
        attemptId,
        sessionId,
      });
    } else if (req.finalizePrepared?.kind === 'active_same_key') {
      emitFinalizeEvent('info', FINALIZE_EVENTS.API_REPLAYED_PENDING, {
        sourceRole: FINALIZE_SOURCE_ROLES.API,
        requestId: req.id ?? null,
        route: req.originalUrl,
        uid: req.user?.uid ?? null,
        sessionId: req.finalizePrepared?.attempt?.sessionId || sessionId,
        attemptId: req.finalizePrepared?.attempt?.attemptId || attemptId,
        finalizeJobId:
          req.finalizePrepared?.attempt?.jobId ||
          req.finalizePrepared?.attempt?.attemptId ||
          attemptId,
        executionAttemptId: req.finalizePrepared?.attempt?.executionAttemptId || null,
        httpStatus: reply.status,
        stage: FINALIZE_STAGES.QUEUE_WAIT,
        jobState:
          req.finalizePrepared?.attempt?.jobState ?? req.finalizePrepared?.attempt?.state ?? 'queued',
        queuedAt: req.finalizePrepared?.attempt?.enqueuedAt ?? null,
      });
      logger.info('story.finalize.replay_pending', {
        routeStatus: `${req.method} ${req.originalUrl}`,
        attemptId: req.finalizePrepared?.attempt?.attemptId || attemptId,
        sessionId: req.finalizePrepared?.attempt?.sessionId || sessionId,
      });
    } else if (req.finalizePrepared?.kind === 'active_other_key') {
      emitFinalizeEvent('warn', FINALIZE_EVENTS.API_CONFLICT_ACTIVE, {
        sourceRole: FINALIZE_SOURCE_ROLES.API,
        requestId: req.id ?? null,
        route: req.originalUrl,
        uid: req.user?.uid ?? null,
        sessionId,
        attemptId,
        finalizeJobId:
          req.finalizePrepared?.attempt?.jobId ||
          req.finalizePrepared?.attempt?.attemptId ||
          attemptId,
        httpStatus: reply.status,
        stage: FINALIZE_STAGES.QUEUE_WAIT,
        jobState:
          req.finalizePrepared?.attempt?.jobState ?? req.finalizePrepared?.attempt?.state ?? 'queued',
        failureReason: 'active_attempt_conflict',
      });
      logger.warn('story.finalize.conflict_active_attempt', {
        routeStatus: `${req.method} ${req.originalUrl}`,
        attemptId,
        sessionId,
        activeAttemptId: req.finalizePrepared?.attempt?.attemptId || null,
      });
    } else if (req.finalizePrepared?.kind === 'done_same_key') {
      emitFinalizeEvent('info', FINALIZE_EVENTS.API_REPLAYED_DONE, {
        sourceRole: FINALIZE_SOURCE_ROLES.API,
        requestId: req.id ?? null,
        route: req.originalUrl,
        uid: req.user?.uid ?? null,
        sessionId: req.finalizePrepared?.attempt?.sessionId || sessionId,
        attemptId: req.finalizePrepared?.attempt?.attemptId || attemptId,
        finalizeJobId:
          req.finalizePrepared?.attempt?.jobId ||
          req.finalizePrepared?.attempt?.attemptId ||
          attemptId,
        executionAttemptId: req.finalizePrepared?.attempt?.executionAttemptId || null,
        shortId: req.finalizePrepared?.attempt?.shortId || null,
        httpStatus: reply.status,
        stage: FINALIZE_STAGES.BILLING_SETTLE,
        jobState:
          req.finalizePrepared?.attempt?.jobState ?? req.finalizePrepared?.attempt?.state ?? 'done',
      });
      logger.info('story.finalize.replay_completed', {
        routeStatus: `${req.method} ${req.originalUrl}`,
        attemptId: req.finalizePrepared?.attempt?.attemptId || attemptId,
        shortId: req.finalizePrepared?.attempt?.shortId || null,
      });
    } else if (req.finalizePrepared?.kind === 'failed_same_key') {
      emitFinalizeEvent('warn', FINALIZE_EVENTS.API_REPLAYED_FAILED, {
        sourceRole: FINALIZE_SOURCE_ROLES.API,
        requestId: req.id ?? null,
        route: req.originalUrl,
        uid: req.user?.uid ?? null,
        sessionId: req.finalizePrepared?.attempt?.sessionId || sessionId,
        attemptId: req.finalizePrepared?.attempt?.attemptId || attemptId,
        finalizeJobId:
          req.finalizePrepared?.attempt?.jobId ||
          req.finalizePrepared?.attempt?.attemptId ||
          attemptId,
        executionAttemptId: req.finalizePrepared?.attempt?.executionAttemptId || null,
        httpStatus: reply.status,
        stage: FINALIZE_STAGES.PERSIST_RECOVERY,
        jobState:
          req.finalizePrepared?.attempt?.jobState ?? req.finalizePrepared?.attempt?.state ?? 'failed',
        ...describeFinalizeError(
          {
            code: req.finalizePrepared?.attempt?.failure?.error || 'STORY_FINALIZE_FAILED',
            status: reply.status,
            message: req.finalizePrepared?.attempt?.failure?.detail || 'Failed to finalize story',
          },
          {
            retryable: false,
            failureReason: 'failed_same_key_replay',
          }
        ),
      });
      logger.warn('story.finalize.replay_failed', {
        routeStatus: `${req.method} ${req.originalUrl}`,
        attemptId: req.finalizePrepared?.attempt?.attemptId || attemptId,
        sessionId: req.finalizePrepared?.attempt?.sessionId || sessionId,
        errorCode: req.finalizePrepared?.attempt?.failure?.error || null,
      });
    }

    return res.status(reply.status).json(reply.body);
  } catch (e) {
    if (res.headersSent) return;
    const mapped = storyFailureFromError(e);
    emitFinalizeEvent('error', FINALIZE_EVENTS.API_REJECTED, {
      sourceRole: FINALIZE_SOURCE_ROLES.API,
      requestId: req.id ?? null,
      route: req.originalUrl,
      uid: req.user?.uid ?? null,
      sessionId: req.body?.sessionId ?? null,
      attemptId: String(req.get('X-Idempotency-Key') || '').trim() || null,
      httpStatus: mapped?.status ?? 500,
      stage: FINALIZE_STAGES.ADMISSION_VALIDATE,
      error: e,
      ...describeFinalizeError(e, {
        errorCode: mapped?.error ?? e?.code ?? 'STORY_FINALIZE_FAILED',
        httpStatus: mapped?.status ?? 500,
        retryable: false,
        failureReason: 'finalize_route_failed',
      }),
    });
    logger.error('story.finalize.failed', {
      routeStatus: `${req.method} ${req.originalUrl}`,
      mappedStatus: mapped?.status,
      mappedError: mapped?.error,
      error: e,
    });
    if (mapped) {
      return sendMappedStoryFailure(req, res, mapped);
    }
    return fail(req, res, 500, 'STORY_FINALIZE_FAILED', e?.message || 'Failed to finalize story');
  }
});

// POST /api/story/manual - Create story session from manual script
r.post('/manual', async (req, res) => {
  try {
    const MAX_TOTAL_CHARS = 850;
    const ManualSchema = z.object({
      scriptText: z.string().min(1).max(MAX_TOTAL_CHARS),
    });

    const parsed = ManualSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return fail(req, res, 400, 'INVALID_INPUT', 'Invalid request', zodFields(parsed.error));
    }

    const { scriptText } = parsed.data;
    const session = await createManualStorySession({
      uid: req.user.uid,
      scriptText,
    });

    return ok(req, res, { sessionId: session.id });
  } catch (e) {
    console.error('[story][manual] error:', e);
    return fail(
      req,
      res,
      500,
      'STORY_MANUAL_FAILED',
      e?.message || 'Failed to create manual story session'
    );
  }
});

// POST /api/story/create-manual-session - Create session from draft beats (manual-first render)
r.post('/create-manual-session', async (req, res) => {
  try {
    // Phase 0: Accept variable-length array (max 8 beats)
    const CreateManualSessionSchema = z.object({
      beats: z
        .array(
          z.object({
            text: z.string(),
            selectedClip: z
              .object({
                id: z.string(),
                url: z.string(),
                thumbUrl: z.string().optional(),
                photographer: z.string().optional(),
              })
              .nullable(),
          })
        )
        .max(8), // Max 8 beats, but can be fewer
    });

    const parsed = CreateManualSessionSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return fail(req, res, 400, 'INVALID_INPUT', 'Invalid request', zodFields(parsed.error));
    }

    let { beats } = parsed.data;
    const uid = req.user.uid;

    // Phase 0: Helper to detect placeholder text
    function isPlaceholderText(text) {
      if (!text || typeof text !== 'string') return true;
      const trimmed = text.trim();
      return (
        trimmed === '' ||
        trimmed === 'Add textâ€¦' ||
        trimmed === 'Add text' ||
        trimmed.toLowerCase() === 'add textâ€¦'
      );
    }

    // Phase 0: Filter out invalid beats (must have both text and clip)
    const validBeats = beats.filter((b) => {
      const hasText = b.text && !isPlaceholderText(b.text);
      const hasClip = b.selectedClip && b.selectedClip.url;
      return hasText && hasClip;
    });

    if (validBeats.length === 0) {
      return fail(
        req,
        res,
        400,
        'INVALID_INPUT',
        'At least one beat must have both text and selectedClip. Empty or placeholder beats cannot be rendered.'
      );
    }

    // Use only valid beats for session creation
    beats = validBeats;

    // Import required utilities
    const { calculateReadingDuration } = await import('../utils/text.duration.js');

    // Create session
    const session = await createStorySession({
      uid,
      input: 'manual',
      inputType: 'paragraph',
    });

    // Build story sentences
    session.story = {
      sentences: beats.map((b) => b.text || ''),
    };

    // Build shots from beats (matching session contract from audit)
    session.shots = beats.map((b, i) => ({
      sentenceIndex: i,
      selectedClip: b.selectedClip || null,
      candidates: b.selectedClip ? [b.selectedClip] : [],
      searchQuery: (b.text || '').trim(),
      durationSec: calculateReadingDuration(b.text || '') || 8,
      visualDescription: '', // Optional, will be generated if needed
      startTimeSec: 0, // Will be recalculated if needed
    }));

    // Set status to clips_searched (skip plan/search steps since clips already selected)
    session.status = 'clips_searched';
    session.updatedAt = new Date().toISOString();
    refreshStorySessionHeuristicEstimate(session);

    // Save session
    console.log('[story][create-manual-session] Saving session:', session.id);
    await saveStorySession({ uid, sessionId: session.id, data: session });

    return ok(req, res, {
      sessionId: session.id,
      session: presentStorySession(session),
    });
  } catch (e) {
    console.error('[story][create-manual-session] error:', e);
    return fail(
      req,
      res,
      500,
      'STORY_CREATE_MANUAL_SESSION_FAILED',
      e?.message || 'Failed to create manual session'
    );
  }
});

// GET /api/story/:sessionId - Get story session
r.get('/:sessionId', async (req, res) => {
  try {
    const sessionId = String(req.params?.sessionId || '').trim();
    if (!sessionId) {
      return fail(req, res, 400, 'INVALID_INPUT', 'sessionId required');
    }
    setRequestContextFromReq(req, { sessionId });

    const session = await getStorySession({
      uid: req.user.uid,
      sessionId,
    });

    if (!session) {
      return fail(req, res, 404, 'SESSION_NOT_FOUND', 'Session not found');
    }

    if (session.renderRecovery?.state) {
      setRequestContextFromReq(req, {
        sessionId,
        attemptId: session.renderRecovery.attemptId || null,
        shortId: session.renderRecovery.shortId || null,
      });
      emitFinalizeEvent('info', FINALIZE_EVENTS.RECOVERY_POLL, {
        sourceRole: FINALIZE_SOURCE_ROLES.API,
        requestId: req.id ?? null,
        route: req.originalUrl,
        uid: req.user?.uid ?? null,
        sessionId,
        attemptId: session.renderRecovery.attemptId || null,
        shortId: session.renderRecovery.shortId || null,
        stage: FINALIZE_STAGES.CLIENT_RECOVERY_POLL,
        jobState: session.renderRecovery.state || null,
      });
      logger.info('story.recovery.poll', {
        routeStatus: `${req.method} ${req.originalUrl}`,
        recoveryState: session.renderRecovery.state,
      });
    }

    return okStorySession(req, res, session);
  } catch (e) {
    logger.error('story.get.failed', {
      routeStatus: `${req.method} ${req.originalUrl}`,
      error: e,
    });
    return fail(req, res, 500, 'STORY_GET_FAILED', e?.message || 'Failed to get story session');
  }
});

export default r;
