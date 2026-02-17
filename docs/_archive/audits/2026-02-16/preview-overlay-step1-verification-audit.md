# Preview Overlay Step 1 — Verification Audit

**Purpose:** Confirm Step 1 is in effect, explain why `[preview-overlay]` did not fire in AJ's test, and provide exact steps to trigger it. No code changes.

---

## 1. Step 1 Implementation Verified

**File:** [public/js/caption-preview.js](public/js/caption-preview.js) — `createCaptionOverlay()`

### Sizing logic (lines 1343–1350)

- Old logic removed; no duplicate `dispW`/`dispH` declarations.
- Raster-aware sizing present:
  - `meta = captionData.meta || {}`
  - `hasRaster = Number.isFinite(meta.rasterW) && Number.isFinite(meta.rasterH)`
  - `baseW`, `baseH` — raster or fallback to wPx/hPx
  - `dispW = baseW * s`, `dispH = baseH * s`

### Debug log (lines 1393–1399)

- `[preview-overlay] positioning:` log exists.
- Includes `rasterW`, `rasterH`, `hasRaster`, `baseW`, `baseH`, `dispW`, `dispH`.
- Log runs before `appendChild`; if `createCaptionOverlay` is called, this log runs.

---

## 2. createCaptionOverlay Call Path Verified

**Callsite:** [creative.html:2144–2149](public/creative.html)

```javascript
if (!useOverlayMode) {
    createCaptionOverlay(result, overlay, { previewW: geometry.cssW, previewH: geometry.cssH, placement });
}
```

- Invoked only when `useOverlayMode` is `false`.
- Inside a debounced callback (300ms) in `updateCaptionOverlay`.
- Prerequisites: container visible, canvas ready, text non-empty, and the debounce having run after `useOverlayMode` became `false`.

---

## 3. Checkbox → useOverlayMode Wiring Verified

**Toggle:** `#overlay-mode-toggle` (creative.html:759)  
**Handler:** `onchange = toggleOverlayMode` (creative.html:10134)

```javascript
useOverlayMode = toggle.checked;  // creative.html:2341
```

- Unchecked → `useOverlayMode = false`.
- Same variable used at the `createCaptionOverlay` callsite (2144).

Note: `toggleOverlayMode` does not call `updateCaptionOverlay`. Switching to legacy mode only updates UI; no caption refresh is triggered.

---

## 4. "Container Not Visible" Guard

**Location:** [creative.html:1900–1904](public/creative.html)

```javascript
if (container.offsetParent === null) {
    console.log('[preview-init] Container not visible, skipping caption overlay');
    return;
}
```

- `container` = `#live-preview-container`.
- `offsetParent === null` when the element or an ancestor has `display: none`.
- If this guard fires, `updateCaptionOverlay` returns before any debounced work. `createCaptionOverlay` is never called.

**Typical causes:**

1. **Mode:** `setStudioMode('articles')` hides `[data-mode="quotes"]`; `#live-preview-container` is inside the quotes content-box.
2. **Ancestor hidden:** Any ancestor of `#live-preview-container` with `display: none` will set `offsetParent` to `null`.
3. **Caption-style section:** It starts with `display: none` and is later moved; visibility depends on the storyboard/mount context.

`opacity-0` does not affect `offsetParent`; the element remains in layout.

---

## 5. Why [preview-overlay] Did Not Appear in AJ's Test

Most likely causes (in order):

### A. useOverlayMode was true (default)

- Default: `useOverlayMode = true`.
- If the overlay toggle was never unchecked, the debounced callback returns at line 2047 and never calls `createCaptionOverlay`.

### B. Toggle switch did not trigger a refresh

- Unchecking sets `useOverlayMode = false` but does not call `updateCaptionOverlay`.
- The legacy path only runs when something else calls `updateCaptionOverlay` after the toggle is unchecked (e.g. font, placement, or quote change).

### C. "Container not visible"

- If `#live-preview-container` (or an ancestor) had `display: none`, `offsetParent === null` causes an early return and the log `[preview-init] Container not visible, skipping caption overlay`.
- Possible when in articles mode or when the quotes section is hidden.

### D. No quote / no asset

- If `currentQuote` or `selectedAsset` was missing, `updateRenderPreview` may not invoke the path that calls `updateCaptionOverlay` with a valid quote, or the condition `if (currentQuote)` may skip the caption update.

---

## 6. Steps to Reliably Trigger [preview-overlay]

1. **Ensure quotes mode**
   - Switch to quotes mode (not articles) so the preview section is visible.

2. **Ensure preview is visible**
   - Select a quote.
   - Select a background (image/video).
   - Confirm `#live-preview-container` is shown (no `opacity-0` or ancestor `display: none`).
   - Check that you do not see `[preview-init] Container not visible, skipping caption overlay`.

3. **Turn off overlay mode**
   - Find "Use Draggable Overlay" (in the Caption Style section, below the storyboard).
   - Uncheck the checkbox.
   - Verify `[overlay-mode] Switched to: legacy overlay` in the console.

4. **Trigger a caption refresh**
   - Change something that calls `updateCaptionOverlay`, for example:
     - Change placement (top/middle/bottom),
     - Change font or weight,
     - Or re-paste/edit the quote slightly.
   - Wait for the 300ms debounce to run.

5. **Confirm success**
   - Look for `[preview-overlay] positioning:` in the console.
   - Check that it shows `hasRaster: true`, `baseH === rasterH`, and `dispH ≈ rasterH * s`.

---

## 7. Quick Checklist

| Requirement | How to ensure |
|-------------|---------------|
| Quotes mode | Use Quotes tab, not Articles |
| Selected asset | Pick an image or video background |
| Quote present | Enter or paste quote text |
| Preview visible | No "Container not visible" log |
| Overlay mode OFF | Uncheck "Use Draggable Overlay" |
| Refresh triggered | Change placement, font, or quote after unchecking |
| Debounce elapsed | Wait ~300ms after the last change |
