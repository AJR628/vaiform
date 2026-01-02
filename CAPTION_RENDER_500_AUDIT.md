# P0 Commit #1 — Caption Render 500 Fix Audit

## A) Findings (with exact code excerpts)

### Import Section (caption.render.routes.js)

**File**: `src/routes/caption.render.routes.js:1-3`
```javascript
import express from "express";
import { CaptionMetaSchema } from '../schemas/caption.schema.js';
import requireAuth from '../middleware/requireAuth.js';
```

**Note**: No import of `renderPreviewImage` at the top of the file.

### Call Site (caption.render.routes.js)

**File**: `src/routes/caption.render.routes.js:41-44`
```javascript
try {
  // For now, return the same as preview - in production you'd integrate with your render pipeline
  const { renderPreviewImage } = await import('./caption.preview.routes.js');
  const outputUrl = await renderPreviewImage(payload);
```

- **Line 43**: Dynamic import attempting to destructure `renderPreviewImage` as a **named export**
- **Line 44**: Calls `renderPreviewImage(payload)` — fails because `renderPreviewImage` is `undefined`

### Export Statement (caption.preview.routes.js)

**File**: `src/routes/caption.preview.routes.js:1664`
```javascript
export default router;
```

- Only exports `router` as **default export**
- No named exports present

### Function Definition (caption.preview.routes.js)

**File**: `src/routes/caption.preview.routes.js:1550-1617`
```javascript
// New overlay format renderer
async function renderPreviewImage(meta) {
  const W = 1080, H = 1920; // Standard canvas dimensions
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d");
  // ... implementation ...
  return canvas.toDataURL("image/png");
}
```

- Function is defined but **NOT exported**
- It's a private function inside the module

### Import/Export Compatibility Analysis

**Problem**: 
- `caption.render.routes.js` line 43: `const { renderPreviewImage } = await import('./caption.preview.routes.js')`
  - Attempts to destructure `renderPreviewImage` as a **named export**
- `caption.preview.routes.js` line 1664: `export default router`
  - Only exports `router` as **default export**
  - `renderPreviewImage` is not exported at all

**Result**: 
- Dynamic import returns `{ default: router }`
- Destructuring `{ renderPreviewImage }` yields `undefined`
- Calling `undefined(payload)` throws `TypeError: renderPreviewImage is not a function`

**Circular Dependency Check**: 
- No circular dependency detected
- `caption.render.routes.js` imports from `caption.preview.routes.js`
- `caption.preview.routes.js` does not import from `caption.render.routes.js`

### Error Response Path

**File**: `src/routes/caption.render.routes.js:53-55`
```javascript
} catch (e) {
  console.error('final render failed', e);
  return res.status(500).json({ success: false, error: 'render_failed' });
}
```

- Inner catch block (line 53) catches the `TypeError`
- Logs error to console (line 54)
- Returns 500 with `{ success: false, error: 'render_failed' }` (line 55)

---

## B) Root Cause

**Issue**: `renderPreviewImage` is not exported from `caption.preview.routes.js`

**Why it fails**:
1. Dynamic import `await import('./caption.preview.routes.js')` returns `{ default: router }`
2. Destructuring `{ renderPreviewImage }` extracts `undefined` (no named export exists)
3. Calling `renderPreviewImage(payload)` throws `TypeError: renderPreviewImage is not a function`
4. Error is caught and returns `{ success: false, error: 'render_failed' }`

---

## C) Plan Options (Minimal Diff)

### Option 1: Add Named Export (RECOMMENDED)

**File to modify**: `src/routes/caption.preview.routes.js`

**Change**: Add named export for `renderPreviewImage` function

**Exact change**:

**Before** (line 1550):
```javascript
// New overlay format renderer
async function renderPreviewImage(meta) {
```

**After** (line 1550):
```javascript
// New overlay format renderer
export async function renderPreviewImage(meta) {
```

**Why it's correct**:
- Makes `renderPreviewImage` available as a named export
- Dynamic import `const { renderPreviewImage } = await import(...)` will work correctly
- Minimal change (add `export` keyword)
- No breaking changes (doesn't affect default export)

**Files changed**: 1 file, 1 line modified

---

### Option 2: Use Default Export Object (ALTERNATIVE - NOT RECOMMENDED)

**File to modify**: `src/routes/caption.preview.routes.js`

**Change**: Export both router and function as default object

**Exact change**:

**Before** (line 1664):
```javascript
export default router;
```

**After** (line 1664):
```javascript
export default { router, renderPreviewImage };
```

**Then modify** `caption.render.routes.js` line 43:
```javascript
const module = await import('./caption.preview.routes.js');
const outputUrl = await module.default.renderPreviewImage(payload);
```

**Why it's less ideal**:
- Requires changes to both files
- More complex import pattern
- Breaks existing default export usage (if any)
- Not recommended — Option 1 is cleaner

---

## D) Recommended Fix (Option 1)

### Implementation

**File**: `src/routes/caption.preview.routes.js`
**Line**: 1550
**Change**: Add `export` keyword to function declaration

```javascript
// New overlay format renderer
export async function renderPreviewImage(meta) {
  // ... existing implementation unchanged ...
}
```

**Files changed**: 1 file, 1 line modified (add `export` keyword)

---

## E) Testing

### Test Command (Minimal Valid Payload)

```bash
curl -X POST http://localhost:3000/api/caption/render \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "placement": "custom",
    "yPct": 0.5,
    "text": "test caption",
    "fontPx": 48,
    "color": "rgb(255,255,255)",
    "opacity": 1.0,
    "fontFamily": "DejaVu Sans",
    "weightCss": "bold",
    "lines": ["test caption"],
    "sizePx": 48
  }' \
  -w "\nHTTP Status: %{http_code}\n" \
  | jq '.'
```

### Expected Response (Success)

```json
{
  "success": true,
  "jobId": "caption_1234567890_abc123",
  "outputUrl": "data:image/png;base64,...",
  "meta": {
    "placement": "custom",
    "yPct": 0.5,
    "text": "test caption",
    ...
  }
}
```

**HTTP Status**: 200

### Expected Response (Before Fix)

```json
{
  "success": false,
  "error": "render_failed"
}
```

**HTTP Status**: 500

---

## F) Definition of Done

- [ ] `renderPreviewImage` exported as named export from `caption.preview.routes.js`
- [ ] `/api/caption/render` returns 200 with `success: true` for minimal valid payload
- [ ] Response includes `jobId`, `outputUrl`, and `meta` fields
- [ ] No 500 errors with `error: "render_failed"`
- [ ] No breaking changes to other routes
- [ ] Test passes with curl command above

---

## G) Verification Checklist

1. **Code Review**:
   - [ ] Verify `export async function renderPreviewImage` exists in `caption.preview.routes.js`
   - [ ] Verify import in `caption.render.routes.js` remains unchanged (dynamic import with destructuring)
   - [ ] Verify no other files import `renderPreviewImage` (should be none)

2. **Runtime Test**:
   - [ ] Run test command with valid auth token
   - [ ] Verify HTTP 200 response
   - [ ] Verify `success: true` in JSON response
   - [ ] Verify `outputUrl` contains base64 data URL
   - [ ] Verify no console errors about "renderPreviewImage is not a function"

3. **Error Handling**:
   - [ ] Verify other error paths still work (invalid payload, auth failures)
   - [ ] Verify error responses maintain expected format

---

## Summary

**Root Cause**: `renderPreviewImage` function is not exported from `caption.preview.routes.js`

**Fix**: Add `export` keyword to function declaration (1 line change)

**Impact**: Minimal — only exposes the function as a named export, doesn't change existing behavior

**Risk**: Low — isolated change, easy to verify, reversible

