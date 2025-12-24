# Option B Sanity Check: Beat Preview TOP-Anchored

**Purpose**: Verify scope, side effects, and parity improvement for Option B (beat preview TOP-anchored fix).

---

## 1. Files That Need Changes

### 1.1 Required Changes

#### A. `public/creative.html`
**Location**: Lines 289-301 (CSS for `.beat-caption-overlay`)
**Change**: Remove `translateY(-50%)` from transform
```css
/* BEFORE */
.beat-caption-overlay {
    transform: translateX(-50%) translateY(-50%);
}

/* AFTER */
.beat-caption-overlay {
    transform: translateX(-50%);
}
```

**Status**: ✅ **ONLY file location** (CSS lives in `<style>` block in HTML)

---

#### B. `public/js/caption-preview.js`
**Location**: Lines 936-952 (`applyPreviewResultToBeatCard` function)
**Change**: Use TOP yPct directly (remove center derivation)
```javascript
/* BEFORE */
const yPct = Number.isFinite(meta.yPct) ? meta.yPct : ((meta.yPx_png + meta.rasterH / 2) / meta.frameH);

/* AFTER */
const yPct = Number.isFinite(meta.yPct) ? meta.yPct : (meta.yPx_png / meta.frameH);
```

**Status**: ✅ **ONLY location** in this file

---

#### C. `public/js/caption-overlay.js`
**Location**: Lines 1750-1755 (`measureBeatCaptionGeometry` function)
**Change**: Remove `translateY(-50%)` from box CSS
```javascript
/* BEFORE */
boxEl.style.cssText = `
    top: ${yPct * 100}%;
    transform: translateY(-50%);
`;

/* AFTER */
boxEl.style.cssText = `
    top: ${yPct * 100}%;
`;
```

**Status**: ✅ **ONLY location** in this function (line 1755)

---

### 1.2 Duplicate Code Found (Needs Fix)

#### D. `public/creative.html` (Inline BeatPreviewManager)
**Location**: Lines 6498-6507 (inline `applyPreview` method)
**Current Code**:
```javascript
const yPct = meta.yPx_png / meta.frameH;  // Already TOP-anchored (correct!)
```

**Status**: ✅ **ALREADY CORRECT** - This code path already uses TOP-anchored calculation, but applies to element with `translateY(-50%)` CSS (mismatch)

**Action**: This code path should use `applyPreviewResultToBeatCard()` from `caption-preview.js` instead of inline duplication, OR remove `translateY(-50%)` from CSS (which we're doing in Option B).

**Conclusion**: Fixing the CSS (Option B) will make this inline code correct automatically.

---

### 1.3 Summary: Files to Change

| File | Lines | Change Type | Risk Level |
|------|-------|-------------|------------|
| `public/creative.html` | 295 | Remove `translateY(-50%)` from CSS | LOW (beat previews only) |
| `public/js/caption-preview.js` | 936 | Use TOP yPct (remove center derivation) | LOW (beat previews only) |
| `public/js/caption-overlay.js` | 1755 | Remove `translateY(-50%)` from box CSS | LOW (offscreen measurement only) |

**Total**: **3 locations in 3 files** ✅

---

## 2. Live Overlay Behavior Verification

### 2.1 Functions That Remain Unchanged (TOP-Anchored)

#### A. `computeCaptionMetaFromElements()` 
**Location**: `caption-overlay.js:1493, 1502`
```javascript
const yPct = (boxRect.top - stageRect.top) / stageHeight;  // TOP-anchored
const yPx_png = Math.round(yPct * frameH);  // TOP-anchored
```
**Status**: ✅ **NO CHANGE NEEDED** (remains TOP-anchored)

---

#### B. `applyCaptionMeta()`
**Location**: `caption-overlay.js:991`
```javascript
if (typeof meta.yPct === 'number') box.style.top = (meta.yPct * 100) + '%';
```
**Status**: ✅ **NO CHANGE NEEDED** (sets top directly, no transform)

---

#### C. Drag Handler (`pointermove`)
**Location**: `caption-overlay.js:296`
```javascript
box.style.top = (y / drag.sh * 100) + '%';
```
**Status**: ✅ **NO CHANGE NEEDED** (sets top directly)

---

#### D. `snapToPlacement()`
**Location**: `caption-overlay.js:1368`
```javascript
box.style.top = `${cssTop}px`;
```
**Status**: ✅ **NO CHANGE NEEDED** (sets top directly, no transform)

**Note**: `computeYPxFromPlacement()` returns TOP of raster PNG, which is correct for TOP-anchored positioning.

---

#### E. Clamp Functions
**Location**: `caption-overlay.js:334, 349, 2365, 2426`
```javascript
box.style.top = (y / s.height * 100) + '%';
box.style.top = `${top}px`;
```
**Status**: ✅ **NO CHANGE NEEDED** (all set top directly)

---

### 2.2 CSS for Live Overlay Box

**Location**: No specific CSS class for `.caption-box` positioning (uses inline styles)

**Current**: Box uses `box.style.top` directly (no transform in CSS)

**After Option B**: ✅ **NO CHANGE** (live overlay box is unaffected)

---

### 2.3 Conclusion: Live Overlay Unaffected

✅ **CONFIRMED**: All live overlay code paths remain TOP-anchored:
- `computeCaptionMetaFromElements()` computes TOP yPct
- `applyCaptionMeta()` sets TOP position
- Drag handlers set TOP position
- `snapToPlacement()` sets TOP position
- CSS has no transform for `.caption-box`

**Zero side effects on live overlay behavior.**

---

## 3. Preview Parity Improvement Proof

### 3.1 Before Option B (Current - Mismatch)

#### Beat Preview Placement (CSS)
```css
.beat-caption-overlay {
    top: calc(var(--y-pct) * 100%);           /* yPct represents TOP */
    transform: translateY(-50%);               /* Centers element */
}
```

**Visual Position**:
- `yPct` = TOP position (0-1, e.g., 0.5 = top at 50% of container)
- CSS centers element: `visual_center = yPct * containerH`
- `visual_top = visual_center - (rasterH / 2) = yPct * containerH - (rasterH / 2)`

**Problem**: As `rasterH` increases (more lines), `visual_top` moves up by `rasterH/2`, causing drift.

---

#### FFmpeg Overlay Placement
```javascript
// ffmpeg.video.js:398, 515
y: overlayCaption.yPx_png  // TOP of PNG in frame space
// FFmpeg overlay filter: overlay=x:y uses Y as top-left of overlay
```

**Position**:
- `yPx_png` = TOP of PNG (0-1920, e.g., 960 = top at 960px)
- FFmpeg places PNG with top at `yPx_png`

---

#### Relationship (Before)
```
Client computes: yPct = (boxRect.top - stageRect.top) / stageHeight  // TOP
Client derives: yPx_png = yPct * frameH  // TOP (960 for yPct=0.5, frameH=1920)

Beat preview CSS:
  yPct = 0.5 (TOP at 50%)
  visual_top = 0.5 * containerH - (rasterH / 2)  // Wrong! Uses TOP yPct but centers

FFmpeg:
  yPx_png = 960 (TOP at 960px)
  PNG top placed at 960px  // Correct
```

**Mismatch**: Beat preview uses TOP yPct but centers it, FFmpeg uses TOP yPx_png directly.

---

### 3.2 After Option B (Fixed - Matched)

#### Beat Preview Placement (CSS)
```css
.beat-caption-overlay {
    top: calc(var(--y-pct) * 100%);           /* yPct represents TOP */
    /* NO translateY(-50%) */                  /* TOP positioning */
}
```

**Visual Position**:
- `yPct` = TOP position (0-1, e.g., 0.5 = top at 50% of container)
- CSS places top directly: `visual_top = yPct * containerH`

**No drift**: As `rasterH` increases, `visual_top` stays fixed (TOP-anchored).

---

#### FFmpeg Overlay Placement
```javascript
// ffmpeg.video.js:398, 515 (unchanged)
y: overlayCaption.yPx_png  // TOP of PNG in frame space
```

**Position**: Same as before (TOP of PNG)

---

#### Relationship (After)
```
Client computes: yPct = (boxRect.top - stageRect.top) / stageHeight  // TOP
Client derives: yPx_png = yPct * frameH  // TOP (960 for yPct=0.5, frameH=1920)

Beat preview CSS:
  yPct = 0.5 (TOP at 50%)
  visual_top = 0.5 * containerH  // Correct! Uses TOP yPct directly

Beat preview JS (applyPreviewResultToBeatCard):
  yPct = meta.yPx_png / meta.frameH  // TOP derivation (if meta.yPct missing)
  // Or: yPct = meta.yPct  // TOP (if present)

FFmpeg:
  yPx_png = 960 (TOP at 960px)
  PNG top placed at 960px  // Correct
```

**Match**: Both beat preview and FFmpeg use TOP-anchored positioning.

---

### 3.3 Parity Equation Proof

#### Beat Preview (After Option B)
```
yPct_top = yPx_png / frameH  // TOP position (0-1)
container_top = yPct_top * containerH  // Scaled to container
```

#### FFmpeg Overlay
```
yPx_png = yPct_top * frameH  // TOP position (0-1920)
overlay_y = yPx_png  // FFmpeg uses Y as top-left
```

#### Scaling Relationship
When beat preview container scales to frame dimensions:
```
containerH = frameH  // Full scale
container_top = yPct_top * frameH = yPx_png  // Matches FFmpeg!
```

✅ **PARITY PROVEN**: Beat preview TOP position matches FFmpeg TOP position when scaled.

---

### 3.4 Example Calculation

**Input**:
- `yPct = 0.5` (center of frame, TOP-anchored)
- `frameH = 1920`
- `rasterH = 200` (text height + padding)

**Client Computation**:
```
yPx_png = 0.5 * 1920 = 960  // TOP of PNG at 960px
```

**Beat Preview (After Option B)**:
```
yPct_top = 960 / 1920 = 0.5  // Or use meta.yPct directly
container_top = 0.5 * containerH  // TOP at 50% of container
```

**FFmpeg Overlay**:
```
overlay_y = 960  // PNG top placed at 960px
```

**Result**: ✅ **PARITY** - Both place PNG top at same relative position (50% of height).

---

### 3.5 Drift Fix Proof

**Before (with translateY(-50%))**:
- Text: 1 line → `rasterH = 100px`
- `yPct = 0.5` → `visual_center = 960px` → `visual_top = 960 - 50 = 910px`

- Text: 5 lines → `rasterH = 300px`  
- `yPct = 0.5` → `visual_center = 960px` → `visual_top = 960 - 150 = 810px`
- **Drift**: TOP moved up by 100px ❌

**After (TOP-anchored, no translateY)**:
- Text: 1 line → `rasterH = 100px`
- `yPct = 0.5` → `visual_top = 960px` ✅

- Text: 5 lines → `rasterH = 300px`
- `yPct = 0.5` → `visual_top = 960px` ✅
- **No drift**: TOP stays fixed ✅

---

## 4. Summary

### 4.1 Scope Confirmation

✅ **ONLY 3 files touched**:
1. `public/creative.html` - Remove `translateY(-50%)` from CSS (1 line)
2. `public/js/caption-preview.js` - Use TOP yPct (1 line change)
3. `public/js/caption-overlay.js` - Remove `translateY(-50%)` from measurement box (1 line)

### 4.2 Side Effects Verification

✅ **LIVE OVERLAY UNAFFECTED**:
- `computeCaptionMetaFromElements()` remains TOP-anchored ✅
- `applyCaptionMeta()` remains TOP-anchored ✅
- Drag handlers remain TOP-anchored ✅
- `snapToPlacement()` remains TOP-anchored ✅
- CSS for `.caption-box` has no transform (unchanged) ✅

### 4.3 Parity Improvement Proof

✅ **PREVIEW PARITY MATCHES FFMPEG**:
- **Before**: Beat preview used TOP yPct but centered it → drift
- **After**: Beat preview uses TOP yPct directly → matches FFmpeg TOP yPx_png
- **Equation**: `yPct_top = yPx_png / frameH` (both TOP-anchored)
- **Scaling**: When `containerH = frameH`, `container_top = yPx_png` ✅

✅ **DRIFT FIXED**:
- Before: `visual_top = yPct * H - rasterH/2` (moves as rasterH grows)
- After: `visual_top = yPct * H` (fixed, no drift)

---

## 5. Risk Assessment

| Risk | Level | Mitigation |
|------|-------|------------|
| Live overlay breakage | **NONE** | Zero code changes to live overlay paths |
| Beat preview visual jump | **LOW** | Preview will shift to correct TOP position (matches render) |
| Stored session data | **NONE** | No stored yPct values (beat previews computed on-demand) |
| Server changes needed | **NONE** | Server already returns TOP yPx_png (correct) |
| FFmpeg changes needed | **NONE** | FFmpeg already uses TOP yPx_png (correct) |

**Overall Risk**: ✅ **LOW** - Isolated to beat preview rendering only.

---

## 6. Recommended Next Steps

1. ✅ **Confirm scope**: 3 files, 3 lines changed
2. ✅ **Verify live overlay**: Zero side effects confirmed
3. ✅ **Prove parity**: Equations match FFmpeg placement
4. ✅ **Assess risk**: Low risk, isolated change

**Ready to implement Option B** ✅

