# Backend Caption Settings SSOT Audit (Phase 1 — Read-Only)

**Branch:** feat/voice-ssot-tts  
**Scope:** Backend contract for mobile caption settings (Placement first). No code changes.

---

## 1. POST /api/story/update-caption-style

**File:** `src/routes/story.routes.js` (lines 144–220)

### Request body shape

- **Root:** `{ sessionId, overlayCaption }`
- **sessionId:** `string`, min 3 chars (required).
- **overlayCaption:** Object; **strict** Zod schema. Only the following keys are accepted (unknown keys rejected):

| Category    | Keys |
|------------|------|
| Typography | `fontFamily`, `fontPx` (8–400), `weightCss` (`'normal'` \| `'bold'` \| `'100'`–`'900'`), `fontStyle` (`'normal'` \| `'italic'`), `letterSpacingPx`, `lineSpacingPx` |
| Color      | `color`, `opacity` (0–1), `strokePx`, `strokeColor`, `shadowBlur`, `shadowOffsetX/Y`, `shadowColor` |
| Placement  | `placement` (`'top'` \| `'center'` \| `'bottom'` \| `'custom'`), `yPct` (0–1), `xPct` (0–1), `wPct` (0–1) |

All fields under `overlayCaption` are **optional**. Mobile can send only `{ sessionId, overlayCaption: { placement: 'top' } }`.

### Response

- **200:** `{ success: true, data: { overlayCaption } }`  
  `data.overlayCaption` is the **full merged style** (style-only, after `extractStyleOnly`), not the full session.
- **400:** validation error (`INVALID_INPUT` + detail).
- **404:** `SESSION_NOT_FOUND`.

### Merge vs overwrite

- **Merge (patch).** Existing `session.overlayCaption` is read; `extractStyleOnly(existing)` is merged with request `overlayCaption`; result is re-sanitized with `extractStyleOnly()` and written back. So only sent fields are updated; others are preserved.

---

## 2. Usage into render

### Where `session.overlayCaption?.style` is read

**File:** `src/services/story.service.js`

- **Line 811:** `const overlayCaption = session.overlayCaption || session.captionStyle;`  
  Used for ASS generation and for passing into `renderVideoQuoteOverlay`.
- **Lines 849–853, 878–882:** `compileCaptionSSOT({ textRaw, style: overlayCaption || {}, frameW: 1080, frameH: 1920 })` — session overlay (style-only) is the style input for compilation.
- **Line 902:** ASS is built with `overlayCaption: meta.effectiveStyle` (compiler output).
- **Line 1019:** `renderVideoQuoteOverlay(..., overlayCaption: overlayCaption)` — raw session `overlayCaption` (style-only) is passed to FFmpeg path.

So render uses **session.overlayCaption** (style-only) both as input to the compiler and as the overlay object for the video pipeline.

### compileCaptionSSOT() consumption

**File:** `src/captions/compile.js`

- **Input style:** Sanitized via `extractStyleOnly(payload.style)`; then merged with `CAPTION_DEFAULTS` in `src/captions/constants.js`.
- **Consumed for wrap/layout:** `fontPx`, `weightCss`, `fontStyle`, `fontFamily`, `letterSpacingPx`, `lineSpacingPx`, `wPct`, `internalPaddingPx` (from style or defaults).
- **Pass-through only (no logic):** `placement`, `yPct`, `color`, `opacity`, and other style keys are carried in `effectiveStyle` but are **not** used inside `compile.js` for layout. They are used downstream (ASS, FFmpeg, overlay helpers).

**File:** `src/captions/constants.js`  
`CAPTION_DEFAULTS` does **not** include `placement` or `yPct`. So those come only from client/session.

### Placement mapping and clamps

- **Preview route (caption.preview.routes.js):**  
  `resolveYpct(clientYPct, clientPlacement)` derives yPct when client omits it:  
  `top` → 0.10, `center` → 0.50, `bottom` → 0.90; custom yPct is clamped to [0.1, 0.9].
- **Story render path:**  
  **No** placement → yPct mapping.  
  **File:** `src/render/overlay.helpers.js` — `computeOverlayPlacement(overlay, W, H)` legacy path (line 301+) uses `yPct` from `overlay` with default `0.5`; it does **not** read `placement` to set yPct.  
  **File:** `src/utils/karaoke.ass.js` — `convertOverlayToASSStyle(overlayCaption, width, height)` uses both `placement` and `yPct`: `placement` for ASS alignment (top/center/bottom); `yPct` for margin math; if `yPct` is missing it defaults to `0.5`. MarginV is clamped to [0, 800].

So for **story render**, if mobile sends only `placement` and does **not** send `yPct`, the effective yPct is **0.5** (center). For placement-only to drive position in final render, either:
- the backend must derive `yPct` from `placement` when `yPct` is absent (e.g. in update-caption-style or in overlay normalization), or  
- mobile must send both `placement` and the corresponding `yPct` (e.g. top=0.1, center=0.5, bottom=0.9).

---

## 3. Supported fonts

### Font files (assets/fonts)

| File                     | Use case        |
|--------------------------|------------------|
| DejaVuSans.ttf           | Regular          |
| DejaVuSans-Bold.ttf       | Bold             |
| DejaVuSans-Oblique.ttf    | Italic           |
| DejaVuSans-BoldOblique.ttf| Bold Italic      |

### Mapping logic (src/utils/font.registry.js)

- `normalizeWeight(weightCss)`: `'bold'` or numeric ≥ 600 → 700; else 400.
- `normalizeFontStyle(fontStyle)`: `'italic'` → `'italic'`, else `'normal'`.
- `resolveFontFile(weightCss, fontStyle)`:
  - 700 + italic → `DejaVuSans-BoldOblique.ttf`
  - 700 + normal → `DejaVuSans-Bold.ttf`
  - 400 + italic → `DejaVuSans-Oblique.ttf`
  - 400 + normal → `DejaVuSans.ttf`

Family name is fixed: **DejaVu Sans** (`FONT_FAMILY`).

### Exact combinations mobile should offer

| Label       | fontFamily  | weightCss | fontStyle |
|------------|-------------|-----------|-----------|
| Regular    | DejaVu Sans | normal    | normal    |
| Bold       | DejaVu Sans | bold (or 700) | normal |
| Italic     | DejaVu Sans | normal    | italic    |
| Bold Italic| DejaVu Sans | bold (or 700) | italic |

Only these four combinations have dedicated font files; other weights/styles collapse to the above via `normalizeWeight` / `normalizeFontStyle`.

---

## 4. Backend contract summary (SSOT for mobile)

- **Endpoint:** `POST /api/story/update-caption-style`  
  Body: `{ sessionId: string, overlayCaption: { placement?: 'top'|'center'|'bottom'|'custom', yPct?: number, ... } }`.  
  Response: `{ success, data: { overlayCaption } }`. Patch merge; only allowed style keys are stored.

- **Placement:**  
  - Allowed values: `top`, `center`, `bottom`, `custom`.  
  - Preview route maps placement → yPct (top 0.1, center 0.5, bottom 0.9).  
  - Story render **does not** derive yPct from placement; it uses `yPct` from session (default 0.5). So for placement-only behavior in final render, either backend will need to set yPct from placement when absent, or mobile sends both placement and yPct.

- **Font:**  
  One family: **DejaVu Sans**. Four variants: Regular, Bold, Italic, Bold Italic (see table above). `fontPx` accepted 8–400; enforced in compile to 32–120.

- **Style whitelist (extractStyleOnly):**  
  Typography: fontFamily, fontPx, weightCss, fontStyle, letterSpacingPx, lineSpacingPx.  
  Color/effects: color, opacity, strokePx, strokeColor, shadowBlur, shadowOffsetX/Y, shadowColor.  
  Placement: placement, yPct, xPct, wPct.  
  Also: internalPaddingPx, internalPadding.

This document is the backend contract for adding mobile caption settings (Placement first) with minimal-diff and no refactors.
