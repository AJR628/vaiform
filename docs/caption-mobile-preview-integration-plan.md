# Caption Mobile Preview Integration Plan (Audit-Updated)

**Status**: Plan updated from dual-repo audit (vaiform-feat-voice-ssot-tts backend + vaiform-mobile-main frontend).  
**Scope**: Additive server-measured preview variant for mobile; desktop remains unchanged.

---

## 1. Audit Summary (Verified)

### 1.1 Backend — SSOT and preview

- **Constants**: [src/captions/constants.js](src/captions/constants.js) — `ENFORCED_FONT_MIN/MAX` 32–120, `CAPTION_LIMITS.safeTopMarginPct` / `safeBottomMarginPct` 0.10, `FRAME_DIMS` 1080×1920. Plan matches.
- **Compiler**: [src/captions/compile.js](src/captions/compile.js) — wrap width, font clamp, line wrapping, `styleHash` / `wrapHash`. Plan matches.
- **Style whitelist**: [src/utils/caption-style-helper.js](src/utils/caption-style-helper.js) — style-only sanitizer; no raster/meta fields. Plan matches.
- **Preview route**: `POST /caption/preview` in [src/routes/caption.preview.routes.js](src/routes/caption.preview.routes.js), mounted under `/api`. Mobile calls `/api/caption/preview`. V3 raster-only (`ssotVersion: 3`, `mode: "raster"`). Rate limit 20/min (comment: “8-beat storyboard”); body limit 200kb.
- **Current contract**: Client-measured geometry required (`rasterW`, `rasterH`, `yPxFirstLine`, `yPx_png`, etc.). Server runs `compileCaptionSSOT`, preserves client geometry, calls `renderCaptionRaster`, returns `data.meta.rasterUrl` (base64 data URL) + meta.

### 1.2 Backend — Render / burn-in

- **FFmpeg raster**: [src/utils/ffmpeg.video.js](src/utils/ffmpeg.video.js) reads `overlayCaption.rasterUrl`, overlays using `yPx_png`, `rasterW`, `rasterH`, `xExpr_png`. Plan matches.
- **ASS/karaoke**: [src/utils/karaoke.ass.js](src/utils/karaoke.ass.js) uses `yPct` when present, or `yPx_png` if provided. Pipeline supports preview raster + render ASS with shared SSOT compile.

### 1.3 Mobile — Current state

- **API**: [client/api/client.ts](https://github.com/vaiform/vaiform-mobile-main) — `Authorization: Bearer <idToken>`, `x-client: mobile`, AbortController + timeouts. Mobile can call `/api/caption/preview` as-is.
- **Caption preview**: No existing usage (no `/caption/preview`, no `rasterUrl` / `captionMeta` in RN UI). Additive integration only.

---

## 2. Alignment Issue and Fix

**Issue**: Preferred mobile approach is “mobile sends text + style + placement only; server computes geometry and returns raster PNG.” The current schema requires client-measured geometry. Using the endpoint as-is from mobile would force faking/duplicating geometry on mobile, violating SSOT.

**Fix**: Add a **discriminated, additive** “server-measured” variant. Desktop path stays identical.

---

## 3. Server-Measured Variant (Mobile)

### 3.1 Trigger

- **Primary**: `body.measure === "server"` → parse **MobileSchema**, run server-measured branch.
- **Fallback** (optional): if `measure` is omitted and `req.get("x-client") === "mobile"` → same.  
  Mobile sends `x-client: mobile` on every request (including future client-measured flows), so the header must not be the only switch.
- **Else**: parse **RasterSchema** (desktop), unchanged.

Implementation: `useServerMeasure = body.measure === "server" || (body.measure == null && req.get("x-client") === "mobile")`. Branch on `useServerMeasure`; leave RasterSchema and desktop path untouched.

### 3.2 MobileSchema (additive only)

**Required**:

- `ssotVersion: 3`, `mode: "raster"`.
- `text` (string, min 1).
- `placement` (`"top"` | `"center"` | `"bottom"`) **or** `yPct` (0–1).

**Optional** (style whitelist only):

- `fontPx`, `lineSpacingPx`, `letterSpacingPx`, `weightCss`, `fontStyle`, `fontFamily`, `textAlign`, `textTransform`.
- `color`, `opacity`, `strokePx`, `strokeColor`, `shadowBlur`, `shadowOffsetX`, `shadowOffsetY`, `shadowColor`.
- `wPct`, `internalPaddingPx` or `rasterPadding`.
- `frameW`, `frameH` (defaults 1080×1920).

**Must NOT require** (server computes): `lines`, `totalTextH`, `yPxFirstLine`, `rasterW`, `rasterH`, `yPx_png`.

### 3.3 Server-side computation (same SSOT as desktop)

1. **Compile**: `compileCaptionSSOT({ textRaw: text, style, frameW, frameH })` → `lines`, `totalTextH`, `maxWidthPx`, `effectiveStyle`, `styleHash`, `wrapHash`.
2. **rasterW**: From `wPct * frameW` (use `effectiveStyle.wPct`), clamped to valid range (e.g. 100–1080). Alternatively derive from `deriveCaptionWrapWidthPx` → `boxW`; same SSOT.
3. **rasterH**: Same formula as in `renderCaptionRaster` (totalTextH + padding top/bottom + shadow). Reuse existing logic ([caption.preview.routes.js](src/routes/caption.preview.routes.js) ~201–210, ~1254–1265).
4. **yPct**: From `placement` or `yPct`. Clamp using **safe margins and rasterH**:
   - `safeTop = safeTopMarginPct * frameH`, `safeBottom = safeBottomMarginPct * frameH`.
   - Ensure `yPct` positions the raster box such that it stays within `[safeTop, frameH - safeBottom - rasterH]`. Clamp `yPct` (or derived top) accordingly—**not** a raw `yPct` clamp only.
5. **yPx_png**: `Math.round(yPct * frameH)` (top-left anchor), clamped to `[safeTop, frameH - safeBottom - rasterH]`.
6. **yPxFirstLine**: `yPx_png + rasterPadding` (match web meta).
7. **previewFontString**: `canvasFontString(weightCss, fontStyle, fontPx, pickFamily(fontFamily))` and pass into `renderCaptionRaster`. Ensures Serif/Sans parity without changing desktop flow.
8. **renderCaptionRaster**: Call with server-derived `lines`, `rasterW`, `rasterH`, `yPx_png`, `previewFontString`, etc. Return same response shape: `data.meta.rasterUrl` + `data.meta` (including `yPx_png`, `rasterW`, `rasterH`, `rasterPadding`, `lines`, `totalTextH`, …).

### 3.4 Response shape (unchanged)

Same as desktop:

- `ok: true`, `data: { imageUrl: null, wPx, hPx, xPx: 0, meta: ssotMeta }`, `meta: compilerMeta`.
- `ssotMeta` includes `rasterUrl`, `yPx_png`, `rasterW`, `rasterH`, `rasterPadding`, `lines`, `totalTextH`, etc.

---

## 4. Caching and Debounce (Mobile)

### 4.1 Cache key

- **Prefer server hashes when available**: If the preview response includes `styleHash` / `wrapHash` (e.g. in `meta` or `data.meta`), use `styleHash|wrapHash|text` (or equivalent) as cache key. Avoids JSON stringification drift.
- **Fallback**: `hashStyleAndText(style, text)` = `JSON.stringify(style, Object.keys(style).sort()) + "|" + text`. Include `placement` if it can change independently.

### 4.2 Debounce and scope

- **Debounce**: 300–400 ms per beat before calling `/api/caption/preview`.
- **Scope**: Only preview the **currently edited/selected** beat when typing. Optional: “tap to refresh preview” for other beats.
- **Stale-response protection**: AbortController per beat (cancel in-flight request when a new one is triggered) or `requestId` compare; ignore outdated responses.

### 4.3 Don’t persist rasterUrl

- **Do not** store `rasterUrl` in Firestore or session long-term. Treat it as UI preview output only.
- **Persist** style + `yPct` + `placement` (and any other whitelisted style fields). Regenerate raster preview when needed (e.g. on focus, after style change).

---

## 5. Risks and Mitigations

| Risk | Mitigation |
|------|------------|
| **Breaking desktop preview** | Discriminated union: `measure === "server"` primary; `x-client: mobile` fallback only when `measure` omitted. Else RasterSchema **unchanged**. No changes to existing required fields or semantics for desktop. |
| **Rate limit throttling** | Preview only current beat + cache + debounce. Optional tap-to-refresh for non-selected beats. Consider raising limit for mobile storyboard (e.g. 60/min) if needed; keep desktop limit as-is. |
| **RN data URI handling** | Test `data:image/png;base64,...` in `<Image source={{ uri: rasterUrl }} />` on **iOS and Android** (one beat, then 8-beat list). If flaky, add a small **fallback route** that returns `image/png` bytes by hash (store meta + hash; fetch by URL). |
| **Geometry drift** | When computing `yPct`, clamp using **safeTop / safeBottom and rasterH / frameH** so the raster box stays fully visible—not a raw `yPct` clamp. |
| **SSOT / naming drift** | Mobile consumes server meta keys **verbatim** (`yPct`, `yPx_png`, `rasterW`, `rasterH`, `rasterPadding`, `lines`, `totalTextH`, etc.). No synonyms or client-invented fields. |

---

## 6. Verification Checklist

### 6.1 Backend

- [ ] **Desktop unchanged**: Same client-measured request payload and response shape as before. No behavior change for web.
- [ ] **Mobile variant**: Request with `measure: "server"` (and optionally `x-client: mobile`) returns:
  - [ ] `data.meta.rasterUrl` present (base64 data URL).
  - [ ] `data.meta` includes `yPx_png`, `rasterW`, `rasterH`, `rasterPadding`, `lines`, `totalTextH`.
- [ ] **Contract tests**: One “client-measured” (desktop) request and one “server-measured” (mobile) request; assert 200 and response shape.

### 6.2 Mobile

- [ ] **Rendering**: `rasterUrl` renders in `<Image />` on **iOS** and **Android** (single beat, then 8-beat list).
- [ ] **Rate limit**: Debounce + cache keep typical editing under 20/min (or configured limit).
- [ ] **Stale-response**: AbortController or requestId compare; outdated responses are ignored.

---

## 7. Minimal-Diff Build Plan

1. **Backend — discriminated handling**
   - Add `MobileSchema` (text, placement or yPct, style whitelist only). Leave `RasterSchema` **unchanged**.
   - At handler start: `useServerMeasure = body.measure === "server" || (body.measure == null && req.get("x-client") === "mobile")`. If `useServerMeasure` → validate `MobileSchema`, run server-measure flow, return; else validate `RasterSchema` and run existing client-measure flow.
   - Reuse `compileCaptionSSOT`, `renderCaptionRaster`, and existing rasterH formula. Add small helpers for placement → yPct and yPct clamp (safe margins + rasterH).
   - Ensure response shape for mobile variant matches desktop (same `data.meta` structure including `rasterUrl`).

2. **Backend — contract tests**
   - Script: `scripts/test-caption-preview-contract.mjs`.
   - Run: `BACKEND_URL=http://localhost:3000 TOKEN=<firebase-id-token> node scripts/test-caption-preview-contract.mjs` (server must be running).
   - Covers: client-measured (desktop) → 200, `data.meta.rasterUrl` + meta; server-measured (`measure: "server"`) → 200, same; `x-client: mobile` fallback (no `measure`) → 200; missing `placement`/`yPct` → 400.

3. **Mobile** (vaiform-mobile-main)
   - **API**: `buildMobilePreviewPayload(text, style, placement)` using whitelisted style keys only. `POST /api/caption/preview` with `measure: "server"`, `text`, `placement`, `style`; keep `x-client: mobile` header. Use existing API client (Bearer, AbortController, timeouts).
   - **Cache**: Prefer `styleHash` / `wrapHash` from response `meta` when available; else `hashStyleAndText(style, text)`. TTL 60s.
   - **Debounce**: 300–400 ms per beat; preview only the **currently edited/selected** beat when typing. AbortController per beat; cancel in-flight request when firing a new one. Optional: “tap to refresh” for non-selected beats.
   - **Render**: Use `data.meta.rasterUrl` (base64 data URL) in `<Image source={{ uri: rasterUrl }} />`. Test on iOS and Android (single beat, then 8-beat list).
   - **Persistence**: Do **not** persist `rasterUrl`. Persist style + `yPct` + `placement`; regenerate preview as needed.
   - **Optional**: Call `POST /api/story/update-caption-meta` with compiler `meta` (response `meta`) **minus** `rasterUrl` when saving beat caption meta.

4. **Optional — RN data URI fallback**
   - If RN data URIs are unreliable: add route `GET /api/caption/preview-image/:hash` returning `image/png` bytes; mobile fetches by hash from meta.

---

## 8. File / Line References (Quick Index)

| Purpose | File | Notes |
|--------|------|--------|
| SSOT constants | [src/captions/constants.js](src/captions/constants.js) | Font clamp, safe margins, frame dims |
| Compiler | [src/captions/compile.js](src/captions/compile.js) | styleHash, wrapHash, lines, totalTextH |
| Style whitelist | [src/utils/caption-style-helper.js](src/utils/caption-style-helper.js) | extractStyleOnly |
| Preview route | [src/routes/caption.preview.routes.js](src/routes/caption.preview.routes.js) | RasterSchema, rate limit, renderCaptionRaster |
| Raster render | [src/routes/caption.preview.routes.js](src/routes/caption.preview.routes.js) ~1083–1546 | renderCaptionRaster, rasterH formula |
| Overlay placement | [src/render/overlay.helpers.js](src/render/overlay.helpers.js) | yPx_png, rasterW, rasterH |
| FFmpeg raster | [src/utils/ffmpeg.video.js](src/utils/ffmpeg.video.js) | overlayCaption.rasterUrl, yPx_png |

---

*Plan updated from dual-repo audit. Desktop path unchanged; mobile uses additive server-measured variant only.*
