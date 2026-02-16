# yPct Anchor Verification Report

**Date**: 2024  
**Purpose**: Verify all caption vertical positioning code paths to identify anchor semantics (TOP vs CENTER) and assess breakage risk before implementing anchor consistency fix.

---

## 1. Positioning Code Inventory

### 1.1 Live Overlay Box (caption-overlay.js)

#### A. Initial Box Position
**Location**: `public/js/caption-overlay.js:59-60`
```javascript
box.style.top = '5%';
```
**Anchor**: TOP-anchored (CSS `top` without transform)

#### B. Drag Handler (pointermove)
**Location**: `public/js/caption-overlay.js:284-296`
```javascript
let y = Math.max(0, Math.min(drag.oy + dy, drag.sh - drag.bh));
box.style.top = (y / drag.sh * 100) + '%';
```
**Anchor**: TOP-anchored (computes `y` from box top position relative to stage)

#### C. Clamp Functions
**Location**: `public/js/caption-overlay.js:325-350`
```javascript
let y = Math.max(0, Math.min(b.top - s.top, s.height - b.height));
box.style.top = (y / s.height * 100) + '%';
```
**Anchor**: TOP-anchored (uses `b.top - s.top`)

#### D. applyCaptionMeta (restore from meta)
**Location**: `public/js/caption-overlay.js:987-991`
```javascript
if (typeof meta.yPct === 'number') box.style.top = (meta.yPct * 100) + '%';
```
**Anchor**: TOP-anchored (assumes yPct represents box top position)

#### E. snapToPlacement
**Location**: `public/js/caption-overlay.js:1332-1372`
```javascript
const targetYPx = window.CaptionGeom.computeYPxFromPlacement(placement, rH);
const cssTop = Math.round(targetYPx * pxFrameToStage);
box.style.top = `${cssTop}px`;
```
**Anchor**: **TOP-anchored** (sets CSS `top` directly, no transform)

**Note**: `computeYPxFromPlacement` returns TOP of raster PNG:
- `'top'` → `SAFE_TOP_PX` (24px from top)
- `'center'` → `(FRAME_H - rasterH) / 2` (center minus half rasterH = top of PNG)
- `'bottom'` → `FRAME_H - rasterH - SAFE_BOTTOM_PX` (top of PNG at bottom)

#### F. computeCaptionMetaFromElements (yPct computation)
**Location**: `public/js/caption-overlay.js:1493`
```javascript
const yPct = (boxRect.top - stageRect.top) / stageHeight;
```
**Anchor**: **TOP-anchored** (computes from box top edge)

#### G. computeCaptionMetaFromElements (yPx_png computation)
**Location**: `public/js/caption-overlay.js:1502`
```javascript
const yPx_png = Math.round(yPct * frameH);
```
**Anchor**: **TOP-anchored** (yPx_png = top of PNG in frame space)

---

### 1.2 Beat Preview Overlay (caption-preview.js + CSS)

#### A. CSS Positioning
**Location**: `public/creative.html:289-295`
```css
.beat-caption-overlay {
    position: absolute;
    left: 50%;
    top: calc(var(--y-pct) * 100%);
    transform: translateX(-50%) translateY(-50%);
}
```
**Anchor**: **CENTER-anchored** (`translateY(-50%)` centers element vertically)

#### B. applyPreviewResultToBeatCard (yPct derivation)
**Location**: `public/js/caption-preview.js:936`
```javascript
const yPct = Number.isFinite(meta.yPct) ? meta.yPct : ((meta.yPx_png + meta.rasterH / 2) / meta.frameH);
```
**Anchor**: **CENTER derivation** (if meta.yPct missing, derives center from TOP yPx_png + rasterH/2)

**Issue**: Falls back to CENTER derivation, but if `meta.yPct` is present, it's TOP-anchored from server, creating mismatch.

#### C. measureBeatCaptionGeometry (box positioning)
**Location**: `public/js/caption-overlay.js:1750-1755`
```javascript
boxEl.style.cssText = `
    top: ${yPct * 100}%;
    transform: translateY(-50%);
`;
```
**Anchor**: **CENTER visually** (CSS centers box), but `yPct` passed in is TOP-anchored from style object

**Issue**: Box is positioned by CENTER via CSS, but `computeCaptionMetaFromElements` computes yPct from TOP (line 1493), creating semantic mismatch.

---

### 1.3 Server Raster Placement (caption.preview.routes.js)

#### A. renderCaptionRaster (yPx computation)
**Location**: `src/routes/caption.preview.routes.js:1346`
```javascript
const yPx = meta.yPxFirstLine - padding;
```
**Anchor**: **TOP-anchored** (yPx = top of PNG, where yPxFirstLine = yPx_png + padding)

**Context**: Client sends `yPxFirstLine` = `yPx_png + rasterPadding`, server computes `yPx = yPxFirstLine - padding` = `yPx_png`.

#### B. Response ssotMeta (yPx_png)
**Location**: `src/routes/caption.preview.routes.js:242, 294`
```javascript
const finalYPx_png = yPx_png;  // Keeps client value (TOP-anchored)
// ...
yPx_png: finalYPx_png,  // Echoed back to client
```
**Anchor**: **TOP-anchored** (TOP of PNG in frame space)

#### C. Response ssotMeta (yPct)
**Location**: `src/routes/caption.preview.routes.js:278-327`
**Missing**: `yPct` is **NOT included in ssotMeta response** (received in request but not echoed back)

---

### 1.4 FFmpeg Overlay Placement (ffmpeg.video.js)

#### A. buildVideoChain (rasterPlacement.y)
**Location**: `src/utils/ffmpeg.video.js:1523, 398, 515`
```javascript
y: overlayCaption.yPx_png ?? overlayCaption.yPx ?? 24,
// ...
const overlayExpr = `[vmain][ovr]overlay=${xExpr}:${y}:format=auto[vout]`;
```
**Anchor**: **TOP-anchored** (FFmpeg `overlay` filter interprets Y as top-left of overlay image)

**Verification**: FFmpeg documentation confirms `overlay=x:y` uses Y as top-left corner of overlay.

---

### 1.5 Live Preview Canvas (caption-live.js)

#### A. toRasterYPx (legacy helper)
**Location**: `public/js/caption-live.js:232-236`
```javascript
function toRasterYPx({frameH, rasterH, placement, yPct, internalPaddingPx}) {
    const pad = Number.isFinite(internalPaddingPx) ? internalPaddingPx : Math.round((yPct ?? 0) * frameH);
    if (placement === 'bottom') return frameH - rasterH - pad;
    if (placement === 'center') return Math.round((frameH - rasterH)/2);
    return pad; // top
}
```
**Anchor**: **TOP-anchored** (returns top of PNG for all placements)

**Note**: `yPct` parameter appears unused in logic (only for pad fallback), placement determines position.

---

## 2. Semantic Dictionary (Current State)

### yPct

| Stage | Location | Computation | Anchor | Canonical Meaning |
|-------|----------|-------------|--------|-------------------|
| **Client DOM → meta** | `caption-overlay.js:1493` | `(boxRect.top - stageRect.top) / stageHeight` | **TOP** | Box top position as fraction of stage height (0=top, 1=bottom) |
| **Beat preview CSS** | `creative.html:292` + `translateY(-50%)` | `calc(var(--y-pct) * 100%)` | **CENTER** (visual) | Element center position (CSS centers it) |
| **Beat preview derivation** | `caption-preview.js:936` | `(yPx_png + rasterH/2) / frameH` | **CENTER** (fallback) | Derived center from TOP yPx_png |
| **Server request** | `caption.preview.routes.js:205` | Received from client | **TOP** (assumed) | Not used directly by server |
| **Server response** | `caption.preview.routes.js:278-327` | **MISSING** | N/A | Not returned in ssotMeta |
| **FFmpeg render** | `ffmpeg.video.js` | Not used | N/A | Uses yPx_png directly |

**Summary**: yPct is **TOP-anchored** in computation, but **CENTER-anchored** in beat preview CSS, creating semantic mismatch.

---

### yPx_png

| Stage | Location | Computation | Anchor | Canonical Meaning |
|-------|----------|-------------|--------|-------------------|
| **Client DOM → meta** | `caption-overlay.js:1502` | `Math.round(yPct * frameH)` | **TOP** | Top-left corner of raster PNG in frame space (0-1920) |
| **Beat preview payload** | `caption-preview.js:728` | Pass-through from overlayMeta | **TOP** | Same as client |
| **Server renderCaptionRaster** | `caption.preview.routes.js:1346` | `meta.yPxFirstLine - padding` | **TOP** | Top of PNG (derived from yPxFirstLine) |
| **Server response** | `caption.preview.routes.js:294` | `finalYPx_png = yPx_png` (echo) | **TOP** | Echoed client value |
| **FFmpeg overlay** | `ffmpeg.video.js:398, 515` | Direct use as Y coordinate | **TOP** | FFmpeg overlay filter Y = top-left of overlay |

**Summary**: yPx_png is **consistently TOP-anchored** throughout (correct for FFmpeg).

---

## 3. Anchor Mismatch Analysis

### 3.1 The Core Problem

**Live Overlay Box**:
- CSS: `box.style.top = (yPct * 100) + '%'` (no transform) → **TOP-anchored**
- Computation: `yPct = (boxRect.top - stageRect.top) / stageHeight` → **TOP-anchored**
- ✅ **Consistent** (TOP → TOP)

**Beat Preview Overlay**:
- CSS: `top: calc(var(--y-pct) * 100%); transform: translateY(-50%);` → **CENTER-anchored** (visual)
- Computation: `yPct = (boxRect.top - stageRect.top) / stageHeight` → **TOP-anchored**
- ❌ **Inconsistent** (TOP computation → CENTER visual positioning)

**Result**: As text grows taller (more lines → larger rasterH), the beat preview drifts upward because:
- `yPct` represents TOP but CSS centers the element
- When `rasterH` increases, the centered element's top moves up by `rasterH/2`
- The visual center stays fixed, but the top edge moves, and since yPct tracks the top, it creates drift

---

### 3.2 Where Assumptions Are Made

#### A. Code Assumes yPct is TOP
1. `caption-overlay.js:1493` - Computes from `boxRect.top`
2. `caption-overlay.js:1502` - `yPx_png = yPct * frameH` (assumes yPct is top)
3. `caption-overlay.js:991` - `box.style.top = (yPct * 100) + '%'` (no transform, assumes top)

#### B. Code Assumes yPct is CENTER
1. `caption-preview.js:936` - Derives center: `(yPx_png + rasterH/2) / frameH`
2. `creative.html:292, 295` - CSS `translateY(-50%)` centers element
3. `caption-overlay.js:1755` - `transform: translateY(-50%)` in measureBeatCaptionGeometry

#### C. Code Uses translateY(-50%)
1. `creative.html:295` - `.beat-caption-overlay { transform: translateX(-50%) translateY(-50%); }`
2. `caption-overlay.js:1755` - Beat measurement box: `transform: translateY(-50%);`

#### D. Code Uses yPx_png + rasterH/2
1. `caption-preview.js:936, 947` - Derives center from TOP: `(yPx_png + rasterH/2) / frameH`

---

## 4. Source of Truth Decision

### 4.1 Option A: Make yPct CENTER-Anchored Everywhere (Recommended)

**Changes Required**:

1. **Client computeCaptionMetaFromElements**:
   - Change: `yPct = (boxRect.top + boxRect.height / 2 - stageRect.top) / stageHeight`
   - Change: `yPx_png = Math.round((yPct * frameH) - (rasterH / 2))` (derive TOP from CENTER)

2. **Client applyCaptionMeta**:
   - Change: Add `transform: translateY(-50%)` to box CSS (or compute `box.style.top` as center position)

3. **Client snapToPlacement**:
   - Change: Compute center position, then set `box.style.top` with `translateY(-50%)`

4. **Client drag handlers**:
   - Change: Track center position during drag, apply with `translateY(-50%)`

5. **Beat preview applyPreviewResultToBeatCard**:
   - Change: Use `meta.yPct` directly (no derivation needed)

6. **Server response**:
   - Change: Include `yPct` in ssotMeta response

7. **Legacy session migration**:
   - Convert stored TOP yPct → CENTER yPct: `yPct_center = (yPct_top * frameH + rasterH/2) / frameH`

---

### 4.2 Option B: Make yPct TOP-Anchored Everywhere

**Changes Required**:

1. **Beat preview CSS**:
   - Remove `translateY(-50%)` transform
   - Use `top: calc(var(--y-pct) * 100%)` directly (TOP positioning)

2. **Beat preview applyPreviewResultToBeatCard**:
   - Use `meta.yPct` directly (no center derivation)

3. **measureBeatCaptionGeometry**:
   - Remove `transform: translateY(-50%)` from box CSS

**Problem**: This makes beat previews TOP-anchored, which may cause visual inconsistency if users expect center-aligned previews.

---

## 5. Breakage Risk Checklist

### 5.1 Stored Data Affected

#### A. Session Storage
**Location**: `session.overlayCaption` or `session.captionStyle`  
**Fields**: `yPct` (stored as TOP-anchored currently)

**Risk**: If we change yPct to CENTER-anchored:
- Existing sessions with saved `yPct` values will have **incorrect positions**
- Shift amount: `(rasterH / 2) / frameH` (typically 0.02-0.05 for medium text)

**Migration Needed**: Convert TOP → CENTER: `yPct_center = (yPct_top * frameH + rasterH/2) / frameH`

**Note**: Requires `rasterH` to convert, which may not be stored in old sessions.

---

#### B. LocalStorage / Window State
**Location**: `window.__overlayMeta`, `window.currentCaptionMeta`

**Risk**: If stored in browser, same conversion needed.

**Mitigation**: Clear on next load, or detect version and convert.

---

### 5.2 UI Components Affected

#### A. Live Overlay Box (caption-overlay.js)
**Risk**: **HIGH** - Visual jump when loading existing session

**What happens**:
- Old sessions: `yPct = 0.5` (TOP at 50% = 960px)
- New code: `yPct = 0.5` (CENTER at 50% = 960px)
- If box is 200px tall, old top was 960px, new center is 960px → **top jumps to 860px** (100px up)

**Mitigation**: 
- Add `transform: translateY(-50%)` to box CSS
- OR: Convert stored yPct on load: `yPct_top = (yPct_center * frameH - rasterH/2) / frameH`

---

#### B. Beat Preview Overlays
**Risk**: **LOW** - Already uses CENTER, just needs correct yPct source

**What happens**:
- Currently: Derives center from TOP yPx_png (fallback)
- After fix: Uses CENTER yPct directly
- **No visual change** (already centered, just fixes drift on text growth)

---

#### C. Server Preview Response
**Risk**: **LOW** - Just adds missing yPct field

**What happens**:
- Currently: `yPct` missing from response
- After fix: `yPct` included (CENTER-anchored)
- Client can use it directly (no derivation needed)

---

#### D. FFmpeg Render
**Risk**: **NONE** - Uses yPx_png directly, not yPct

**What happens**:
- No change needed (yPx_png remains TOP-anchored, correct for FFmpeg)

---

### 5.3 Tests/Logs That Would Catch Issues

#### A. Parity Checklist Logs
**Location**: `src/routes/caption.preview.routes.js:364-400`

**Current**: Logs client `yPx_png` (TOP), compares with render  
**After fix**: Should log `yPct` (CENTER) + derived `yPx_png` (TOP)

**Verification**: Check logs show `yPct` in response meta.

---

#### B. Contract Tests
**Location**: None found (would need to add)

**Recommendation**: Add test that verifies:
- Preview response includes `yPct`
- `yPct` represents center position
- `yPx_png` = `(yPct * frameH) - (rasterH / 2)` (TOP derived from CENTER)

---

#### C. Manual Test Scenario
**Steps**:
1. Create session with caption at center (yPct = 0.5)
2. Add long text (5+ lines) → verify preview doesn't drift up
3. Render video → verify caption matches preview position
4. Reload session → verify caption position unchanged

**Expected**: No drift, position matches preview, reload preserves position.

---

## 6. Recommended Approach

### 6.1 Choose CENTER-Anchored yPct (Option A)

**Rationale**:
1. Beat previews already use CENTER (CSS `translateY(-50%)`)
2. More intuitive for users (center position is stable as text grows)
3. Matches placement presets (top/center/bottom = center positions)
4. Server can return yPct without client needing to derive it

---

### 6.2 Migration Strategy

#### Phase 1: Add yPct to Server Response (Non-Breaking)
- Include `yPct` in ssotMeta (computed from client yPct, or derive from yPx_png if missing)
- Client can use it but doesn't break if missing

#### Phase 2: Fix Client Computation (Breaking, needs migration)
- Change `computeCaptionMetaFromElements` to compute CENTER yPct
- Change `yPx_png` computation to derive TOP from CENTER
- Add migration for stored sessions: convert TOP → CENTER

#### Phase 3: Update Live Overlay CSS (Breaking, needs CSS change)
- Add `transform: translateY(-50%)` to `.caption-box` CSS
- Update drag handlers to track center position

---

### 6.3 Critical Conversion Formula

**TOP → CENTER**:
```javascript
yPct_center = (yPct_top * frameH + rasterH / 2) / frameH
```

**CENTER → TOP**:
```javascript
yPct_top = (yPct_center * frameH - rasterH / 2) / frameH
```

**Note**: Requires `rasterH` for conversion. For stored sessions without rasterH, estimate from `totalTextH` or use a default (e.g., 150px).

---

## 7. Summary of Findings

| Component | Current Anchor | After Fix (Option A) | Breakage Risk |
|-----------|----------------|---------------------|---------------|
| **Client yPct computation** | TOP | CENTER | HIGH (stored sessions) |
| **Client yPx_png computation** | TOP (from TOP yPct) | TOP (from CENTER yPct) | LOW (derived, not stored) |
| **Live overlay box CSS** | TOP (no transform) | CENTER (add transform) | HIGH (visual jump) |
| **Beat preview CSS** | CENTER (translateY) | CENTER (unchanged) | LOW (already correct) |
| **Server response yPct** | Missing | CENTER (add field) | LOW (non-breaking) |
| **FFmpeg overlay** | TOP (yPx_png) | TOP (unchanged) | NONE (correct) |

**Primary Risk**: Stored sessions with TOP-anchored `yPct` will shift position after migration.

**Mitigation**: Convert stored values on load, or version metadata and handle both formats during transition period.

