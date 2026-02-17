# Caption Style Persistence — Final Implementation Plan (2 Commits)

**Date**: 2026-01-07  
**Status**: Pre-implementation verification complete  
**Approach**: Two-commit incremental rollout to minimize risk

---

## Pre-Implementation Verification Results

### ✅ Endpoint Path Correctness

**Verified**:
- `apiFetch('/story/update-caption-style')` → `${API_ROOT}/story/update-caption-style` where `API_ROOT = BACKEND_URL` includes `/api`
- Story router mounted at `/api/story` in `src/app.js:255`
- Route `r.post("/update-caption-style")` → Final path: `/api/story/update-caption-style` ✅

**Evidence**:
- `public/api.mjs:154` - `const urlApi = ${API_ROOT}${path}` where `API_ROOT` includes `/api`
- `src/app.js:255` - `app.use("/api/story", routes.story)`
- `src/routes/story.routes.js:27` - `const r = Router()` with routes like `r.post("/start", ...)`

### ✅ Current captionStyle Shape

**UI Construction** (`public/creative.html:2009`):
```javascript
const captionStyle = {
    text: text.trim(),                    // ❌ Beat-specific, NOT in whitelist
    fontFamily: fontConfig.family,        // ✅ In whitelist
    weightCss: fontConfig.weightCss,      // ✅ In whitelist
    fontPx: sizePx,                       // ✅ In whitelist
    color: "#FFFFFF",                     // ✅ In whitelist
    opacity: opacityPct / 100,           // ✅ In whitelist
    shadow: true,                        // ⚠️ Boolean, NOT in whitelist (will drop)
    showBox: showBoxToggle,               // ⚠️ Boolean, NOT in whitelist (will drop)
    boxColor: `rgba(0,0,0,${boxOpacityPct/100})`, // ⚠️ NOT in whitelist (will drop)
    placement: placementData.placement,   // ✅ In whitelist
    yPct: placementData.placement === 'bottom' ? 0.90 : ..., // ✅ In whitelist
    lineHeight: 1.05,                     // ⚠️ NOT in whitelist (will drop)
    padding: 24,                          // ⚠️ NOT in whitelist (will drop)
    maxWidthPct: 0.90,                    // ⚠️ NOT in whitelist (will drop)
    borderRadius: 16                      // ⚠️ NOT in whitelist (will drop)
};
```

**Decision**: Drop non-whitelist fields (`shadow`, `showBox`, `boxColor`, `lineHeight`, `padding`, `maxWidthPct`, `borderRadius`, `text`). These are UI-only and not used by render pipeline. User-visible but safe (render uses server defaults).

**Alternative UI Construction** (`public/creative.html:5403`):
- Different shape (`font`, `weight`, `sizePx` vs `fontFamily`, `weightCss`, `fontPx`)
- This is for quote render path, not story render path
- Story path uses line 2009 shape

### ✅ Session Rebuild Patterns

**Verified**: All session writes use "load → modify → save" pattern:
- `createStorySession` - Creates new session (no existing `overlayCaption` to clobber)
- `generateStory` - `loadStorySession` → modify `story` → save (preserves existing fields)
- `updateStorySentences` - `loadStorySession` → modify `story.sentences` → save (preserves existing fields)
- All other paths follow same pattern

**No dangerous patterns found**:
- No `session = { id, uid, story: ... }` rebuilds
- No `const next = { story: ..., shots: ... }` passed to `saveStorySession`
- `ensureSessionDefaults` only sets missing fields, doesn't rebuild object

### ✅ Session ID Guard

**Current**: `preserveCaptionOverrides` doesn't check `session.id` (line 7106)

**Fix Required**: Add session ID check OR simplify/no-op since we have explicit Apply button.

**Recommendation**: Add session ID check for safety, but since Apply button is explicit, preservation logic is less critical.

---

## Must-Be-True Guardrails (Before Any Wiring)

### ✅ Guardrail 1: Style-Only Schema (Strict)

**Server Schema** (`src/routes/story.routes.js`):
```javascript
const CaptionStyleSchema = z.object({
  // Typography
  fontFamily: z.string().optional(),
  fontPx: z.number().min(8).max(400).optional(),
  weightCss: z.enum(['normal', 'bold', '100', '200', '300', '400', '500', '600', '700', '800', '900']).optional(),
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
}).strict(); // ← CRITICAL: Rejects unknown fields
```

**Verification**: `.strict()` ensures any field not in schema is rejected (e.g., `mode`, `lines`, `rasterUrl`).

### ✅ Guardrail 2: Client extractStyleOnly() Before POST

**Client Helper** (`public/js/caption-style-helper.js`):
```javascript
export function extractStyleOnly(obj) {
  if (!obj || typeof obj !== 'object') return {};
  
  const allowed = [
    'fontFamily', 'fontPx', 'weightCss', 'fontStyle',
    'letterSpacingPx', 'lineSpacingPx',
    'color', 'opacity', 'strokePx', 'strokeColor',
    'shadowBlur', 'shadowOffsetX', 'shadowOffsetY', 'shadowColor',
    'placement', 'yPct', 'xPct', 'wPct'
  ];
  
  const styleOnly = {};
  for (const key of allowed) {
    if (Object.prototype.hasOwnProperty.call(obj, key)) {
      styleOnly[key] = obj[key];
    }
  }
  
  return styleOnly;
}
```

**Usage**: Always call `extractStyleOnly(captionStyle)` before POSTing to route.

### ✅ Guardrail 3: Render Guard Log

**Location**: `src/services/story.service.js:810` (before ASS generation)

```javascript
const overlayCaption = session.overlayCaption || session.captionStyle;

// Safety guard: Warn if dangerous fields present
if (overlayCaption) {
  const dangerousKeys = ['mode', 'lines', 'rasterUrl', 'rasterHash'];
  const foundDangerous = dangerousKeys.filter(k => 
    Object.prototype.hasOwnProperty.call(overlayCaption, k)
  );
  if (foundDangerous.length > 0) {
    console.warn(`[render-guard] Found dangerous fields in overlayCaption: ${foundDangerous.join(', ')}. These should not be in global style.`);
  }
}
```

**Verification**: Logs warning if dangerous fields ever appear in session `overlayCaption`.

---

## Two-Commit Implementation Plan

### Commit 1: Server Infrastructure (No UI Wiring)

**Goal**: Add server-side route + guardrails. Cannot break preview/render because nothing calls it yet.

**Files Changed**:

1. **`src/utils/caption-style-helper.js`** (NEW):
   ```javascript
   /**
    * Extract style-only fields (server-side whitelist)
    * Strips all preview/geometry/mode fields
    */
   export function extractStyleOnly(obj) {
     if (!obj || typeof obj !== 'object') return {};
     
     const allowed = [
       'fontFamily', 'fontPx', 'weightCss', 'fontStyle',
       'letterSpacingPx', 'lineSpacingPx',
       'color', 'opacity', 'strokePx', 'strokeColor',
       'shadowBlur', 'shadowOffsetX', 'shadowOffsetY', 'shadowColor',
       'placement', 'yPct', 'xPct', 'wPct'
     ];
     
     const styleOnly = {};
     for (const key of allowed) {
       if (Object.prototype.hasOwnProperty.call(obj, key)) {
         styleOnly[key] = obj[key];
       }
     }
     
     return styleOnly;
   }
   ```

2. **`src/routes/story.routes.js`** (ADD route):
   ```javascript
   import { extractStyleOnly } from '../utils/caption-style-helper.js';
   
   // Add after line 141 (after /update-script route)
   r.post("/update-caption-style", async (req, res) => {
     try {
       const CaptionStyleSchema = z.object({
         fontFamily: z.string().optional(),
         fontPx: z.number().min(8).max(400).optional(),
         weightCss: z.enum(['normal', 'bold', '100', '200', '300', '400', '500', '600', '700', '800', '900']).optional(),
         fontStyle: z.enum(['normal', 'italic']).optional(),
         letterSpacingPx: z.number().optional(),
         lineSpacingPx: z.number().optional(),
         color: z.string().optional(),
         opacity: z.number().min(0).max(1).optional(),
         strokePx: z.number().min(0).optional(),
         strokeColor: z.string().optional(),
         shadowBlur: z.number().min(0).optional(),
         shadowOffsetX: z.number().optional(),
         shadowOffsetY: z.number().optional(),
         shadowColor: z.string().optional(),
         placement: z.enum(['top', 'center', 'bottom', 'custom']).optional(),
         yPct: z.number().min(0).max(1).optional(),
         xPct: z.number().min(0).max(1).optional(),
         wPct: z.number().min(0).max(1).optional(),
       }).strict(); // Reject unknown fields
       
       const parsed = z.object({
         sessionId: z.string().min(3),
         overlayCaption: CaptionStyleSchema
       }).safeParse(req.body || {});
       
       if (!parsed.success) {
         return res.status(400).json({
           success: false,
           error: "INVALID_INPUT",
           detail: parsed.error.flatten()
         });
       }
       
       const { sessionId, overlayCaption } = parsed.data;
       const session = await getStorySession({
         uid: req.user.uid,
         sessionId
       });
       
       if (!session) {
         return res.status(404).json({
           success: false,
           error: "SESSION_NOT_FOUND"
         });
       }
       
       // Merge style into session (extract style-only from existing if present)
       const existing = session.overlayCaption || {};
       const existingStyleOnly = extractStyleOnly(existing);
       const mergedStyle = { ...existingStyleOnly, ...overlayCaption };
       
       // Strip any dangerous fields that might exist (defensive)
       session.overlayCaption = extractStyleOnly(mergedStyle);
       session.updatedAt = new Date().toISOString();
       
       await saveStorySession({ uid: req.user.uid, sessionId, data: session });
       
       return res.json({ 
         success: true, 
         data: { overlayCaption: session.overlayCaption } 
       });
     } catch (e) {
       console.error("[story][update-caption-style] error:", e);
       return res.status(500).json({
         success: false,
         error: "STORY_UPDATE_CAPTION_STYLE_FAILED",
         detail: e?.message || "Failed to update caption style"
       });
     }
   });
   ```

3. **`src/services/story.service.js`** (ADD render guard log at line 810):
   ```javascript
   const overlayCaption = session.overlayCaption || session.captionStyle;
   
   // Safety guard: Warn if dangerous fields present
   if (overlayCaption) {
     const dangerousKeys = ['mode', 'lines', 'rasterUrl', 'rasterHash'];
     const foundDangerous = dangerousKeys.filter(k => 
       Object.prototype.hasOwnProperty.call(overlayCaption, k)
     );
     if (foundDangerous.length > 0) {
       console.warn(`[render-guard] Found dangerous fields in overlayCaption: ${foundDangerous.join(', ')}. These should not be in global style.`);
     }
   }
   ```

**Testing Commit 1**:
- ✅ Server starts without errors
- ✅ Route exists at `/api/story/update-caption-style` (test with curl/Postman)
- ✅ Schema rejects `{ mode: 'raster', fontPx: 48 }` (should return 400)
- ✅ Schema accepts `{ fontPx: 48, weightCss: 'bold' }` (should return 200)
- ✅ Render guard log doesn't fire (no dangerous fields in current sessions)

**Rollback Risk**: **ZERO** - Route exists but nothing calls it. Render unchanged.

---

### Commit 2: Client UI Wiring (Explicit Apply Button)

**Goal**: Add "Apply Caption Settings" button that POSTs to route and refreshes previews.

**Files Changed**:

1. **`public/js/caption-style-helper.js`** (NEW):
   ```javascript
   /**
    * Extract style-only fields from any caption object (whitelist)
    * Strips all preview/geometry/mode fields
    */
   export function extractStyleOnly(obj) {
     if (!obj || typeof obj !== 'object') return {};
     
     const allowed = [
       'fontFamily', 'fontPx', 'weightCss', 'fontStyle',
       'letterSpacingPx', 'lineSpacingPx',
       'color', 'opacity', 'strokePx', 'strokeColor',
       'shadowBlur', 'shadowOffsetX', 'shadowOffsetY', 'shadowColor',
       'placement', 'yPct', 'xPct', 'wPct'
     ];
     
     const styleOnly = {};
     for (const key of allowed) {
       if (Object.prototype.hasOwnProperty.call(obj, key)) {
         styleOnly[key] = obj[key];
       }
     }
     
     return styleOnly;
   }
   ```

2. **`public/creative.html`** (ADD Apply button + handler):
   - Add button near caption controls (after line ~2100)
   - Add handler function `applyCaptionStyle()`
   - Wire button click to handler

3. **`public/creative.html`** (UPDATE `preserveCaptionOverrides` at line 7106):
   ```javascript
   function preserveCaptionOverrides(nextSession, prevSession) {
       // CRITICAL: Only preserve if same session (prevent style bleed)
       if (!prevSession || nextSession?.id !== prevSession?.id) {
           return; // Different session - don't preserve
       }
       
       const hasOwn = Object.prototype.hasOwnProperty;
       for (const key of ['overlayCaption', 'captionStyle']) {
           const nextHasNonEmpty =
               hasOwn.call(nextSession || {}, key) &&
               nextSession[key] &&
               Object.keys(nextSession[key]).length > 0;

           const prevHasNonEmpty =
               prevSession &&
               prevSession[key] &&
               Object.keys(prevSession[key]).length > 0;

           // Server wins if it has a non-empty object; otherwise carry forward client overrides.
           if (!nextHasNonEmpty && prevHasNonEmpty) {
               nextSession[key] = prevSession[key];
           }
       }
   }
   ```

4. **`public/creative.html`** (UPDATE preview call sites at lines 7582, 8334):
   ```javascript
   // OLD: const explicitStyle = session.overlayCaption || session.captionStyle || {};
   // NEW:
   const { extractStyleOnly } = await import('./js/caption-style-helper.js');
   const rawStyle = session.overlayCaption || session.captionStyle || {};
   const explicitStyle = extractStyleOnly(rawStyle); // Safety guard
   ```

5. **`public/js/caption-preview.js`** (UPDATE `generateBeatCaptionPreview` at line 794):
   ```javascript
   export async function generateBeatCaptionPreview(beatId, text, style) {
     // ... existing code ...
     
     // Extract style-only (safety guard - strip any dangerous fields)
     const { extractStyleOnly } = await import('./caption-style-helper.js');
     const explicitStyle = extractStyleOnly(style || {});
     
     // ... rest of function unchanged ...
   }
   ```

**Testing Commit 2**:
- ✅ Apply button appears in UI
- ✅ Click Apply → POST succeeds → `session.overlayCaption` saved
- ✅ Reload page → Style restored from session
- ✅ Edit beat → Preview uses saved style (check logs)
- ✅ Render → Uses SSOT wrapper + ASS subtitles (not raster mode)

**Rollback Risk**: **LOW** - If Apply fails, worst case: button doesn't work, render still works. Can disable button or revert commit.

---

## Final Verification Checklist

### Pre-Commit 1
- [ ] Server starts without errors
- [ ] No existing route conflicts

### Post-Commit 1
- [ ] Route accessible at `/api/story/update-caption-style`
- [ ] Schema rejects `{ mode: 'raster' }` (400 error)
- [ ] Schema accepts `{ fontPx: 48 }` (200 success)
- [ ] Render guard log doesn't fire (no dangerous fields)

### Post-Commit 2
- [ ] Apply button appears and works
- [ ] Style persists across page reload
- [ ] Preview uses saved style
- [ ] Render uses SSOT wrapper (not pre-wrapped lines)
- [ ] Render uses ASS subtitles (not raster mode)
- [ ] No console errors

---

## Risk Assessment

**Commit 1 Risk**: **ZERO** - Route exists but unused. Cannot break existing functionality.

**Commit 2 Risk**: **LOW** - If Apply fails, button doesn't work but render still works. Can disable button or revert.

**Overall Risk**: **LOW** - Guardrails prevent catastrophic breakage. Incremental rollout allows instant rollback.
