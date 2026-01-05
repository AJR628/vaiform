import { Router } from "express";
import { z, ZodError } from "zod";
import requireAuth from "../middleware/requireAuth.js";
import { enforceCreditsForRender, enforceScriptDailyCap } from "../middleware/planGuards.js";
import { spendCredits, refundCredits, RENDER_CREDIT_COST } from "../services/credit.service.js";
import { withRenderSlot } from "../utils/render.semaphore.js";
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
  insertBeatWithSearch,
  deleteBeat,
  updateBeatText,
  buildTimeline,
  generateCaptionTimings,
  renderStory,
  finalizeStory,
  saveStorySession
} from "../services/story.service.js";

const r = Router();
r.use(requireAuth);

const StartSchema = z.object({
  input: z.string().min(1).max(2000),
  inputType: z.enum(["link", "idea", "paragraph"]).default("paragraph"),
  styleKey: z.enum(["default", "hype", "cozy"]).optional().default("default"),
});

const SessionSchema = z.object({
  sessionId: z.string().min(3),
});

const GenerateSchema = z.object({
  sessionId: z.string().min(3),
  input: z.string().min(1).max(2000).optional(),
  inputType: z.enum(["link", "idea", "paragraph"]).optional(),
});

// POST /api/story/start - Create session, accept input
r.post("/start", async (req, res) => {
  try {
    const parsed = StartSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        error: "INVALID_INPUT",
        detail: parsed.error.flatten()
      });
    }
    
    const { input, inputType, styleKey } = parsed.data;
    const session = await createStorySession({
      uid: req.user.uid,
      input,
      inputType,
      styleKey
    });
    
    return res.json({ success: true, data: session });
  } catch (e) {
    console.error("[story][start] error:", e);
    return res.status(500).json({
      success: false,
      error: "STORY_START_FAILED",
      detail: e?.message || "Failed to create story session"
    });
  }
});

// POST /api/story/generate - Generate story from input
r.post("/generate", enforceScriptDailyCap(300), async (req, res) => {
  try {
    const parsed = GenerateSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        error: "INVALID_INPUT",
        detail: parsed.error.flatten()
      });
    }
    
    const { sessionId, input, inputType } = parsed.data;
    const session = await generateStory({
      uid: req.user.uid,
      sessionId,
      input,
      inputType
    });
    
    return res.json({ success: true, data: session });
  } catch (e) {
    console.error("[story][generate] error:", e);
    return res.status(500).json({
      success: false,
      error: "STORY_GENERATE_FAILED",
      detail: e?.message || "Failed to generate story"
    });
  }
});

// POST /api/story/update-script - Update story sentences (when user edits script)
r.post("/update-script", async (req, res) => {
  try {
    const UpdateScriptSchema = z.object({
      sessionId: z.string().min(3),
      sentences: z.array(z.string().min(1)).min(1)
    });
    
    const parsed = UpdateScriptSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        error: "INVALID_INPUT",
        detail: parsed.error.flatten()
      });
    }
    
    const { sessionId, sentences } = parsed.data;
    const session = await updateStorySentences({
      uid: req.user.uid,
      sessionId,
      sentences
    });
    
    return res.json({ success: true, data: session });
  } catch (e) {
    console.error("[story][update-script] error:", e);
    return res.status(500).json({
      success: false,
      error: "STORY_UPDATE_SCRIPT_FAILED",
      detail: e?.message || "Failed to update story script"
    });
  }
});

// POST /api/story/plan - Generate visual plan
r.post("/plan", enforceScriptDailyCap(300), async (req, res) => {
  try {
    const parsed = SessionSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        error: "INVALID_INPUT",
        detail: parsed.error.flatten()
      });
    }
    
    const { sessionId } = parsed.data;
    const session = await planShots({
      uid: req.user.uid,
      sessionId
    });
    
    return res.json({ success: true, data: session });
  } catch (e) {
    console.error("[story][plan] error:", e);
    return res.status(500).json({
      success: false,
      error: "STORY_PLAN_FAILED",
      detail: e?.message || "Failed to plan shots"
    });
  }
});

// POST /api/story/search - Search and select clips (Phase 3)
r.post("/search", async (req, res) => {
  try {
    const parsed = SessionSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        error: "INVALID_INPUT",
        detail: parsed.error.flatten()
      });
    }
    
    const { sessionId } = parsed.data;
    const session = await searchShots({
      uid: req.user.uid,
      sessionId
    });
    
    return res.json({ success: true, data: session });
  } catch (e) {
    console.error("[story][search] error:", e);
    return res.status(500).json({
      success: false,
      error: "STORY_SEARCH_FAILED",
      detail: e?.message || "Failed to search clips"
    });
  }
});

// POST /api/story/update-shot - Update selected clip for a shot (Phase 2 - Clip Swap)
r.post("/update-shot", async (req, res) => {
  try {
    const UpdateShotSchema = z.object({
      sessionId: z.string().min(3),
      sentenceIndex: z.number().int().min(0),
      clipId: z.string().min(1)
    });
    
    const parsed = UpdateShotSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        error: "INVALID_INPUT",
        detail: parsed.error.flatten()
      });
    }
    
    const { sessionId, sentenceIndex, clipId } = parsed.data;
    const result = await updateShotSelectedClip({
      uid: req.user.uid,
      sessionId,
      sentenceIndex,
      clipId
    });
    
    return res.json({ success: true, data: result });
  } catch (e) {
    console.error("[story][update-shot] error:", e);
    return res.status(500).json({
      success: false,
      error: "STORY_UPDATE_SHOT_FAILED",
      detail: e?.message || "Failed to update shot"
    });
  }
});

// POST /api/story/search-shot - Search clips for a single shot (Phase 3 - Clip Search)
r.post("/search-shot", async (req, res) => {
  try {
    const SearchShotSchema = z.object({
      sessionId: z.string().min(3),
      sentenceIndex: z.number().int().min(0),
      query: z.string().optional(),
      page: z.number().int().min(1).optional()
    });
    
    const parsed = SearchShotSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        error: "INVALID_INPUT",
        detail: parsed.error.flatten()
      });
    }
    
    const { sessionId, sentenceIndex, query, page = 1 } = parsed.data;
    const result = await searchClipsForShot({
      uid: req.user.uid,
      sessionId,
      sentenceIndex,
      query,
      page
    });
    
    return res.json({ 
      success: true, 
      data: { 
        shot: result.shot, 
        page: result.page, 
        hasMore: result.hasMore 
      } 
    });
  } catch (e) {
    console.error("[story][search-shot] error:", e);
    return res.status(500).json({
      success: false,
      error: "STORY_SEARCH_SHOT_FAILED",
      detail: e?.message || "Failed to search clips for shot"
    });
  }
});

// POST /api/story/insert-beat - Insert a new beat with automatic clip search
r.post("/insert-beat", async (req, res) => {
  try {
    const InsertBeatSchema = z.object({
      sessionId: z.string().min(3),
      insertAfterIndex: z.number().int().min(-1),
      text: z.string().min(1)
    });
    
    const parsed = InsertBeatSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        error: "INVALID_INPUT",
        detail: parsed.error.flatten()
      });
    }
    
    const { sessionId, insertAfterIndex, text } = parsed.data;
    const result = await insertBeatWithSearch({
      uid: req.user.uid,
      sessionId,
      insertAfterIndex,
      text
    });
    
    return res.json({ success: true, data: result });
  } catch (e) {
    console.error("[story][insert-beat] error:", e);
    return res.status(500).json({
      success: false,
      error: "STORY_INSERT_BEAT_FAILED",
      detail: e?.message || "Failed to insert beat"
    });
  }
});

// POST /api/story/delete-beat - Delete a beat (sentence + shot)
r.post("/delete-beat", async (req, res) => {
  try {
    const DeleteBeatSchema = z.object({
      sessionId: z.string().min(3),
      sentenceIndex: z.number().int().min(0)
    });
    
    const parsed = DeleteBeatSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        error: "INVALID_INPUT",
        detail: parsed.error.flatten()
      });
    }
    
    const { sessionId, sentenceIndex } = parsed.data;
    const result = await deleteBeat({
      uid: req.user.uid,
      sessionId,
      sentenceIndex
    });
    
    return res.json({ success: true, data: result });
  } catch (e) {
    console.error("[story][delete-beat] error:", e);
    return res.status(500).json({
      success: false,
      error: "STORY_DELETE_BEAT_FAILED",
      detail: e?.message || "Failed to delete beat"
    });
  }
});

// POST /api/story/update-beat-text - Update beat text
const UpdateBeatTextSchema = z.object({
  sessionId: z.string().min(3),
  sentenceIndex: z.number().int().min(0),
  text: z.string().min(1),
});

r.post("/update-beat-text", async (req, res) => {
  try {
    const { sessionId, sentenceIndex, text } = UpdateBeatTextSchema.parse(req.body);
    const uid = req.user.uid;
    
    const { sentences, shots } = await updateBeatText({
      uid,
      sessionId,
      sentenceIndex,
      text,
    });
    
    return res.json({
      success: true,
      data: { sentences, shots },
    });
  } catch (e) {
    const isZod = e instanceof ZodError;
    const status = isZod ? 400 : 500;
    const errorCode = isZod
      ? "STORY_UPDATE_BEAT_TEXT_INVALID"
      : "STORY_UPDATE_BEAT_TEXT_FAILED";
    
    console.error("[story][update-beat-text] error:", e);
    
    return res.status(status).json({
      success: false,
      error: errorCode,
      detail: e?.message,
    });
  }
});

// POST /api/story/timeline - Build stitched video (Phase 4)
r.post("/timeline", async (req, res) => {
  try {
    const parsed = SessionSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        error: "INVALID_INPUT",
        detail: parsed.error.flatten()
      });
    }
    
    const { sessionId } = parsed.data;
    const session = await buildTimeline({
      uid: req.user.uid,
      sessionId
    });
    
    return res.json({ success: true, data: session });
  } catch (e) {
    console.error("[story][timeline] error:", e);
    return res.status(500).json({
      success: false,
      error: "STORY_TIMELINE_FAILED",
      detail: e?.message || "Failed to build timeline"
    });
  }
});

// POST /api/story/captions - Generate caption timings (Phase 5)
r.post("/captions", async (req, res) => {
  try {
    const parsed = SessionSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        error: "INVALID_INPUT",
        detail: parsed.error.flatten()
      });
    }
    
    const { sessionId } = parsed.data;
    const session = await generateCaptionTimings({
      uid: req.user.uid,
      sessionId
    });
    
    return res.json({ success: true, data: session });
  } catch (e) {
    console.error("[story][captions] error:", e);
    return res.status(500).json({
      success: false,
      error: "STORY_CAPTIONS_FAILED",
      detail: e?.message || "Failed to generate caption timings"
    });
  }
});

// POST /api/story/render - Render final video (Phase 6)
r.post("/render", async (req, res) => {
  try {
    const parsed = SessionSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        error: "INVALID_INPUT",
        detail: parsed.error.flatten()
      });
    }
    
    const { sessionId } = parsed.data;
    const session = await renderStory({
      uid: req.user.uid,
      sessionId
    });
    
    return res.json({ success: true, data: session });
  } catch (e) {
    console.error("[story][render] error:", e);
    return res.status(500).json({
      success: false,
      error: "STORY_RENDER_FAILED",
      detail: e?.message || "Failed to render story"
    });
  }
});

// POST /api/story/finalize - Run full pipeline (Phase 7)
r.post("/finalize", enforceCreditsForRender(), async (req, res) => {
  try {
    const parsed = SessionSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        error: "INVALID_INPUT",
        detail: parsed.error.flatten()
      });
    }
    
    const { sessionId } = parsed.data;
    // NOTE: finalizeStory() blocks the HTTP request until render completes (synchronous operation).
    // Server timeout is set to 15 minutes to accommodate long renders. For scalability,
    // background job queue is planned (P2).
    const session = await withRenderSlot(() => finalizeStory({
      uid: req.user.uid,
      sessionId,
      options: req.body.options || {}
    }));
    
    // Spend credits only if render succeeded
    let creditsSpent = false;
    if (session?.finalVideo?.url) {
      try {
        await spendCredits(req.user.uid, RENDER_CREDIT_COST);
        creditsSpent = true;
      } catch (err) {
        console.error("[story][finalize] Failed to spend credits:", err);
        // Don't fail the request - credits were already checked by middleware
      }
    }
    
    const shortId = session?.finalVideo?.jobId || null;
    try {
      return res.json({ 
        success: true, 
        data: session,
        shortId: shortId  // Top-level for convenience
      });
    } catch (err) {
      // If response failed after credits were spent, refund defensively
      if (creditsSpent && !res.headersSent) {
        try {
          await refundCredits(req.user.uid, RENDER_CREDIT_COST);
          console.log("[story][finalize] Refunded credits after response failure");
        } catch (refundErr) {
          console.error("[story][finalize] Failed to refund credits after response failure:", refundErr);
        }
      }
      throw err; // Re-throw so outer catch handles it
    }
  } catch (e) {
    if (res.headersSent) return;
    if (e?.code === "SERVER_BUSY" || e?.message === "SERVER_BUSY") {
      res.set("Retry-After", "30");
      return res.status(503).json({ success: false, error: "SERVER_BUSY", retryAfter: 30 });
    }
    console.error("[story][finalize] error:", e);
    return res.status(500).json({
      success: false,
      error: "STORY_FINALIZE_FAILED",
      detail: e?.message || "Failed to finalize story"
    });
  }
});

// POST /api/story/manual - Create story session from manual script
r.post("/manual", async (req, res) => {
  try {
    const MAX_TOTAL_CHARS = 850;
    const ManualSchema = z.object({
      scriptText: z.string().min(1).max(MAX_TOTAL_CHARS)
    });
    
    const parsed = ManualSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        error: "INVALID_INPUT",
        detail: parsed.error.flatten()
      });
    }
    
    const { scriptText } = parsed.data;
    const session = await createManualStorySession({
      uid: req.user.uid,
      scriptText
    });
    
    return res.json({ success: true, data: { sessionId: session.id } });
  } catch (e) {
    console.error("[story][manual] error:", e);
    return res.status(500).json({
      success: false,
      error: "STORY_MANUAL_FAILED",
      detail: e?.message || "Failed to create manual story session"
    });
  }
});

// POST /api/story/create-manual-session - Create session from draft beats (manual-first render)
r.post("/create-manual-session", async (req, res) => {
  try {
    // Phase 0: Accept variable-length array (max 8 beats)
    const CreateManualSessionSchema = z.object({
      beats: z.array(z.object({
        text: z.string(),
        selectedClip: z.object({
          id: z.string(),
          url: z.string(),
          thumbUrl: z.string().optional(),
          photographer: z.string().optional()
        }).nullable()
      })).max(8) // Max 8 beats, but can be fewer
    });
    
    const parsed = CreateManualSessionSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        error: "INVALID_INPUT",
        detail: parsed.error.flatten()
      });
    }
    
    let { beats } = parsed.data;
    const uid = req.user.uid;
    
    // Phase 0: Helper to detect placeholder text
    function isPlaceholderText(text) {
      if (!text || typeof text !== 'string') return true;
      const trimmed = text.trim();
      return trimmed === '' || 
             trimmed === 'Add text…' || 
             trimmed === 'Add text' ||
             trimmed.toLowerCase() === 'add text…';
    }
    
    // Phase 0: Filter out invalid beats (must have both text and clip)
    const validBeats = beats.filter(b => {
      const hasText = b.text && !isPlaceholderText(b.text);
      const hasClip = b.selectedClip && b.selectedClip.url;
      return hasText && hasClip;
    });
    
    if (validBeats.length === 0) {
      return res.status(400).json({
        success: false,
        error: "INVALID_INPUT",
        detail: "At least one beat must have both text and selectedClip. Empty or placeholder beats cannot be rendered."
      });
    }
    
    // Use only valid beats for session creation
    beats = validBeats;
    
    // Import required utilities
    const { calculateReadingDuration } = await import('../utils/text.duration.js');
    
    // Create session
    const session = await createStorySession({
      uid,
      input: 'manual',
      inputType: 'paragraph'
    });
    
    // Build story sentences
    session.story = {
      sentences: beats.map(b => b.text || '')
    };
    
    // Build shots from beats (matching session contract from audit)
    session.shots = beats.map((b, i) => ({
      sentenceIndex: i,
      selectedClip: b.selectedClip || null,
      candidates: b.selectedClip ? [b.selectedClip] : [],
      searchQuery: (b.text || '').trim(),
      durationSec: calculateReadingDuration(b.text || '') || 8,
      visualDescription: '', // Optional, will be generated if needed
      startTimeSec: 0 // Will be recalculated if needed
    }));
    
    // Set status to clips_searched (skip plan/search steps since clips already selected)
    session.status = 'clips_searched';
    session.updatedAt = new Date().toISOString();
    
    // Save session
    console.log('[story][create-manual-session] Saving session:', session.id);
    await saveStorySession({ uid, sessionId: session.id, data: session });
    
    return res.json({
      success: true,
      data: {
        sessionId: session.id,
        session
      }
    });
  } catch (e) {
    console.error("[story][create-manual-session] error:", e);
    return res.status(500).json({
      success: false,
      error: "STORY_CREATE_MANUAL_SESSION_FAILED",
      detail: e?.message || "Failed to create manual session"
    });
  }
});

// GET /api/story/:sessionId - Get story session
r.get("/:sessionId", async (req, res) => {
  try {
    const sessionId = String(req.params?.sessionId || "").trim();
    if (!sessionId) {
      return res.status(400).json({
        success: false,
        error: "INVALID_INPUT",
        message: "sessionId required"
      });
    }
    
    const session = await getStorySession({
      uid: req.user.uid,
      sessionId
    });
    
    if (!session) {
      return res.status(404).json({
        success: false,
        error: "NOT_FOUND"
      });
    }
    
    return res.json({ success: true, data: session });
  } catch (e) {
    console.error("[story][get] error:", e);
    return res.status(500).json({
      success: false,
      error: "STORY_GET_FAILED",
      detail: e?.message || "Failed to get story session"
    });
  }
});

export default r;

