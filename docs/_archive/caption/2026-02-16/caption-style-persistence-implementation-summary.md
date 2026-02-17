# Caption Style Persistence — Implementation Summary

**Status**: ✅ Pre-implementation verification complete  
**Approach**: Two-commit incremental rollout  
**Risk Level**: LOW (mitigated by guardrails)

---

## Must-Be-True Guardrails (Verified)

### ✅ Guardrail 1: Style-Only Schema (Strict)

**Server**: Zod schema with `.strict()` rejects unknown fields (`mode`, `lines`, `rasterUrl`, etc.)

**Location**: `src/routes/story.routes.js` - `CaptionStyleSchema.strict()`

**Verification**: Schema defined, `.strict()` ensures rejection of dangerous fields.

### ✅ Guardrail 2: Client extractStyleOnly() Before POST

**Client**: Always call `extractStyleOnly(captionStyle)` before POSTing to route.

**Location**: `public/js/caption-style-helper.js` - `extractStyleOnly()` function

**Verification**: Helper function defined, whitelist enforced.

### ✅ Guardrail 3: Render Guard Log

**Server**: Warns if dangerous fields (`mode`, `lines`, `rasterUrl`, `rasterHash`) appear in session `overlayCaption`.

**Location**: `src/services/story.service.js:810` - Before ASS generation

**Verification**: Guard log code defined, will catch accidental persistence.

---

## Verified Gotchas

### ✅ Endpoint Path

- `apiFetch('/story/update-caption-style')` → `/api/story/update-caption-style` ✅
- Route mounted at `/api/story` ✅
- No path conflicts ✅

### ✅ captionStyle Shape

- UI produces: `fontFamily`, `weightCss`, `fontPx`, `color`, `opacity`, `placement`, `yPct` (in whitelist) ✅
- UI also produces: `text`, `shadow`, `showBox`, `boxColor`, `lineHeight`, `padding`, `maxWidthPct`, `borderRadius` (will drop, safe) ✅

### ✅ Session Rebuild Patterns

- All paths use "load → modify → save" (preserves existing fields) ✅
- No dangerous rebuilds found ✅

### ✅ Session ID Guard

- `preserveCaptionOverrides` will check `session.id` before preserving ✅

---

## Two-Commit Plan

### Commit 1: Server Infrastructure

**Files**:
- `src/utils/caption-style-helper.js` (NEW)
- `src/routes/story.routes.js` (ADD route)
- `src/services/story.service.js` (ADD guard log)

**Risk**: ZERO (route unused)

### Commit 2: Client UI Wiring

**Files**:
- `public/js/caption-style-helper.js` (NEW)
- `public/creative.html` (ADD Apply button, fix preservation, update preview calls)
- `public/js/caption-preview.js` (ADD style extraction guard)

**Risk**: LOW (if Apply fails, render still works)

---

## Full Details

See:
- `docs/caption-style-persistence-safety-audit.md` - Complete audit findings
- `docs/caption-style-persistence-final-implementation-plan.md` - Detailed 2-commit plan
- `c:\Users\ajrhe\.cursor\plans\caption_style_persistence_with_pipeline_safety_guards_cdd6252e.plan.md` - Full implementation plan
