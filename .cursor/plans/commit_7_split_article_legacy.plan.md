---
name: ""
overview: ""
todos: []
isProject: false
---

# Commit 7: Split creative.main.mjs into Article Entry + Legacy (Audit + Plan)

## Goal

Reduce parse/execute cost on `/creative.html` by splitting [public/js/pages/creative/creative.main.mjs](public/js/pages/creative/creative.main.mjs) into:

- **creative.article.mjs** (loaded by default): Article Explainer + storyboard + beat preview + clip picker + caption style + renderArticle only.
- **creative.legacy-quotes.mjs** (not loaded by default): Quote/live-preview/asset browser/remix/renderShort/stage overlay code.

---

## Required audit (before implementation)

### 1) creative.html is Article-only

- Confirm [public/creative.html](public/creative.html) contains no `#stage`, no `#caption-live`, no `#live-preview-container`, no quote/asset UI.
- After Commits 4–6 the page is Article-only; no DOM for legacy mode.

### 2) window.* exports required by ui-actions.js

- [public/js/ui-actions.js](public/js/ui-actions.js) calls only: `window.summarizeArticle`, `window.prepareStoryboard`, `window.renderArticle`.
- **creative.article.mjs must define these three** on window. No other window exports are required for the Article page.

### 3) Article beat preview and CaptionGeom (important correction)

- **Article main still depends on window.CaptionGeom indirectly.** The chain is:
  - Article beat preview uses **caption-preview.js** (`generateBeatCaptionPreview`).
  - caption-preview.js imports **caption-overlay.js** (`measureBeatCaptionGeometry`).
  - caption-overlay.js in `measureBeatCaptionGeometry()` and `computeCaptionMetaFromElements()` calls **window.CaptionGeom.parseShadow(...)** and **window.CaptionGeom.computeRasterH(...)** without optional chaining.
- So: **Keep the caption-geom.js script tag in creative.html.** Do not remove it in Commit 7 (or ever for Article-only).
- In creative.article.mjs it is fine to never reference CaptionGeom directly; the dependency is indirect via caption-preview → caption-overlay.

---

## Two “be thorough” tweaks (baked in)

### Tweak 1: CaptionGeom stays; Article has indirect dependency

- Plan text must not say “Article has no helpers that depend on CaptionGeom.” It does: caption-preview → caption-overlay → measureBeatCaptionGeometry → window.CaptionGeom.
- **Action:** Keep caption-geom.js in creative.html. creative.article.mjs does not need to reference CaptionGeom in code; caption-overlay (used by caption-preview) expects it on window at runtime.

### Tweak 2: Legacy runnability (choose one)

- Commit 6 removed script tags for caption-live, render-payload-helper, and the extractLinesStable window-assign. If legacy is ever loaded (e.g. for debugging), it would be half-broken unless it self-loads those dependencies.
- **Option A — Legacy archival only:** Do nothing extra; legacy can be broken when loaded.
- **Option B — Legacy still runnable (recommended):** In creative.legacy-quotes.mjs, add a small top-level “boot dependencies” block that:
  - Only runs when legacy DOM exists, e.g. `if (document.querySelector('#stage')) { ... }`
  - `await import('/js/render-payload-helper.js')` and assign the five functions to window (or re-use the same pattern creative.html used before Commit 6).
  - `await import('/js/caption-live.js')` (no need to call init until overlay init runs).
  - Re-expose `extractLinesStable` (and if needed `extractRenderedLines`) from caption-overlay.js onto window so buildRasterFromBrowser/savePreview still work.

**Recommendation:** Use **(B)** so the legacy file remains loadable for debugging and does not regress if someone points HTML at it later.

---

## Implementation steps (minimal-risk)

### Step 1: Create creative.article.mjs

- **New file:** [public/js/pages/creative/creative.article.mjs](public/js/pages/creative/creative.article.mjs).
- **Contents:** Extract from creative.main.mjs only:
  - **Helpers used by Article flow:** showError, hideError, showToast, showAuthRequiredModal, showFreeLimitModal, setLoading, isUrl (and any minimal shared deps: e.g. getApiBase if needed, config import).
  - **Article block:** From `// Article mode constants` (line ~5031) through the three window exports (summarizeArticle, prepareStoryboard, renderArticle) at ~8672–8674. This includes: MAX_BEATS, normalizeScript, generateBeatId, isValidBeat, isPlaceholderText, summarizeArticle, prepareStoryboard, renderArticle, renderStoryboard, openClipPicker, BeatPreviewManager, setupSwapButtonHandlers, handleSwapButtonClick, beat focus modal, script preview input handler, caption-style mount listener, ensureSessionFromDraft, updateScriptCounters, isStoryboardDirty, and any other Article-only functions used in that block.
  - **Article-only event wiring:** Script preview input, prepare-storyboard flow, storyboard row click (swap/add clip), beat focus modal (keydown + DOMContentLoaded), caption-style-mount DOMContentLoaded, and any DOMContentLoaded/click that only touches Article IDs (article-input, article-script-preview, storyboard, clip-picker, caption-style-section, etc.).
- **Ensure:** Zero references in creative.article.mjs to: `#stage`, `caption-live`, `savePreview`, `renderShort`, `remixQuote`, `selectedAsset`, `asset-grid`, `extractLinesStable`, overlay/quote-only DOM or functions.
- **Ensure:** window.summarizeArticle, window.prepareStoryboard, window.renderArticle are defined.
- **Dependencies:** Article uses dynamic `import('/api.mjs')` for apiFetch; uses `/js/caption-preview.js` via BeatPreviewManager (generateBeatCaptionPreview path). caption-geom.js remains loaded by creative.html so window.CaptionGeom is present when caption-overlay runs.

### Step 2: Create creative.legacy-quotes.mjs

- **Rename/move:** Current [public/js/pages/creative/creative.main.mjs](public/js/pages/creative/creative.main.mjs) → [public/js/pages/creative/creative.legacy-quotes.mjs](public/js/pages/creative/creative.legacy-quotes.mjs) (keep file intact).
- **Optional but recommended (B):** At the top of creative.legacy-quotes.mjs (after imports), add a boot block that loads Commit-6-removed dependencies when legacy DOM exists:
  ```js
  // Boot: restore dependencies removed in Commit 6 so legacy mode can still run if loaded
  if (typeof document !== 'undefined' && document.querySelector('#stage')) {
    try {
      const rph = await import('/js/render-payload-helper.js');
      window.getSavedOverlayMeta = rph.getSavedOverlayMeta;
      window.validateOverlayCaption = rph.validateOverlayCaption;
      window.validateBeforeRender = rph.validateBeforeRender;
      window.showPreviewSavedIndicator = rph.showPreviewSavedIndicator;
      window.markPreviewUnsaved = rph.markPreviewUnsaved;
    } catch (e) { console.warn('[legacy] render-payload-helper load failed', e); }
    try {
      await import('/js/caption-live.js');
    } catch (e) { console.warn('[legacy] caption-live load failed', e); }
    try {
      const co = await import('/js/caption-overlay.js');
      window.extractRenderedLines = co.extractRenderedLines;
      window.extractLinesStable = co.extractLinesStable;
    } catch (e) { console.warn('[legacy] caption-overlay window assign failed', e); }
  }
  ```
  (If the file is not async top-level, wrap in an async IIFE and run it before the rest of the module.)

### Step 3: Update creative.html

- Change the main script src from:
  - `src="/js/pages/creative/creative.main.mjs"`
- To:
  - `src="/js/pages/creative/creative.article.mjs"`

### Step 4 (optional): Shim for cached HTML

- If you want old cached creative.html (still pointing at creative.main.mjs) to work, leave a tiny [public/js/pages/creative/creative.main.mjs](public/js/pages/creative/creative.main.mjs) that only does:
  - `import './creative.article.mjs';`
- So no 404 and the default entry becomes the article bundle.

---

## Verification checklist (thorough)

After the split:

1. **Load** `/creative.html` — No console errors (no missing IDs such as #stage, #quote-*, #asset-grid).
2. **Summarize** — Paste or type article input, click Summarize; script appears.
3. **Prepare Storyboard** — Click Prepare Storyboard; storyboard cards render.
4. **Swap clip** — Open a beat / swap clip; clip picker works; caption preview still renders (validates caption-geom.js + caption-overlay path).
5. **Caption style** — Change font/size/placement in caption-style-section; no errors.
6. **Insert/delete beat** — Session + draft paths still work.
7. **Render** — Click Render; finalize runs and navigates to My Shorts (or shows video).
8. **Grep audit:** Confirm [public/js/pages/creative/creative.article.mjs](public/js/pages/creative/creative.article.mjs) contains **zero** references to:
  - `#stage`
  - `caption-live`
  - `savePreview`
  - `renderShort`
  - `remixQuote`
  - `selectedAsset`
  - `asset-grid`
  - `extractLinesStable`

---

## Summary


| Item                             | Action                                                                                                                          |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| caption-geom.js in creative.html | **Keep** (Article beat preview → caption-overlay → window.CaptionGeom).                                                         |
| creative.article.mjs             | **New** — Article-only code + helpers + Article event wiring; no quote/stage/live refs.                                         |
| creative.legacy-quotes.mjs       | **Rename from creative.main.mjs**; add optional boot block (B) to load render-payload-helper, caption-live, extractLinesStable. |
| creative.html script             | **Point to creative.article.mjs.**                                                                                              |
| creative.main.mjs                | **Optional shim** `import './creative.article.mjs';` for cached HTML.                                                           |


