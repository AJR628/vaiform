# Phase 0 & 1 Audit Report

## Executive Summary
**Status: RISKS FOUND** - Multiple assumptions about fixed 8-beat structure need to be updated. Clip picker state management is mostly correct but needs ID-based updates.

---

## 1. Call Sites of `/api/story/create-manual-session`

### Found: 1 call site

**File:** `public/creative.html`  
**Line:** 7857-7865  
**Context:** `ensureSessionFromDraft()` function

```7857:7865:public/creative.html
const resp = await apiFetch('/story/create-manual-session', {
    method: 'POST',
    body: {
        beats: window.draftStoryboard.beats.map(b => ({
            text: b.text || '',
            selectedClip: b.selectedClip || null
        }))
    }
});
```

**Payload Shape:**
- `beats`: Array of objects
  - `text`: string (may be empty)
  - `selectedClip`: object with `{id, url, thumbUrl?, photographer?}` OR `null`

**Current Issue:** Sends ALL beats from `window.draftStoryboard.beats` (currently always 8). No filtering for invalid/placeholder beats.

---

## 2. Assumptions About Manual Beats Length = 8

### Found: 12 locations

#### Backend (2 locations)

1. **`src/routes/story.routes.js:572`**
   - Schema validation: `.length(8)` - **HARD CONSTRAINT**
   - **RISK:** Will reject any payload with != 8 beats

2. **`src/services/story.service.js:29`**
   - Constant: `const MAX_BEATS = 8;`
   - Used in `createManualStorySession()` validation (line 1054)
   - **SAFE:** This is a max limit, not a fixed requirement

#### Frontend (10 locations)

3. **`public/creative.html:1469`**
   - Initialization: `Array(8).fill(null).map(...)`
   - **RISK:** Must change to 1 beat

4. **`public/creative.html:3576`**
   - Re-initialization: `Array(8).fill(null).map(...)`
   - **RISK:** Must change to 1 beat

5. **`public/creative.html:6002`**
   - Constant: `const MAX_BEATS = 8;`
   - **SAFE:** Used for validation/capping, not initialization

6. **`public/creative.html:6075-6077`**
   - Validation: `if (beats.length > MAX_BEATS)` - truncates to 8
   - **SAFE:** This is max limit logic

7. **`public/creative.html:6113`**
   - UI counter: `Beats: ${beats.length} / ${MAX_BEATS}`
   - **SAFE:** Display only

8. **`public/creative.html:6312`**
   - Reset after script storyboard: `Array(8).fill(null).map(...)`
   - **RISK:** Should reset to 1 beat (or clear entirely)

9. **`public/creative.html:6399`**
   - Reset after manual script: `Array(8).fill(null).map(...)`
   - **RISK:** Should reset to 1 beat (or clear entirely)

10. **`public/creative.html:6931`**
    - Fallback initialization: `Array(8).fill(null).map(...)`
    - **RISK:** Must change to 1 beat

11. **`public/creative.html:7400`**
    - Fallback initialization: `Array(8).fill(null).map(...)`
    - **RISK:** Must change to 1 beat

12. **`public/creative.html:7881`**
    - Reset after session creation: `Array(8).fill(null).map(...)`
    - **RISK:** Should reset to 1 beat (or clear entirely)

---

## 3. Placeholder Strings

### Found: 2 placeholder strings in draft storyboard UI

**File:** `public/creative.html`

1. **Line 6590:** `'Add text…'` (with ellipsis)
   - Used when `beat.text` is empty/null
   - Context: Draft beat card text area

2. **Line 6624:** `'Add text…'` (with ellipsis)
   - Same placeholder, used when beat has clip but no text

**Other placeholders found (not related to beats):**
- Line 6582: `"+ Add clip"` - UI text for missing clip placeholder (not a text field value)

**Recommendation:**
Create `isPlaceholderText(text)` function:
```javascript
function isPlaceholderText(text) {
    if (!text || typeof text !== 'string') return true;
    const trimmed = text.trim();
    return trimmed === '' || 
           trimmed === 'Add text…' || 
           trimmed === 'Add text' ||
           trimmed.toLowerCase() === 'add text…';
}
```

---

## 4. Clip Picker State Variables

### Variables Found:

1. **`window.clipPickerIsDraft`** (boolean)
   - Set: Line 7107 (draft mode), Line 7126 (session mode = false)
   - Cleared: Line 7186, 7440
   - **STATUS:** ✅ Properly set/cleared

2. **`window.clipPickerSentenceIndex`** (number, draft mode only)
   - Set: Line 7108 (draft mode)
   - Cleared: Line 7187, 7441
   - Used: Line 7151, 7382, 7637, 7716
   - **RISK:** Uses numeric index, needs to change to `clipPickerBeatId` (string) for Phase 1

3. **`window.currentClipPickerSentence`** (number, session mode only)
   - Set: Line 7127 (session mode)
   - Cleared: Line 7185
   - Used: Line 7382, 7159
   - **STATUS:** ✅ Properly separated from draft mode

4. **`window.draftClipPickerPage`** (number)
   - Set: Line 7109, 7210, 7227, 7248, 7263, 7646
   - Used: Line 7156, 7247, 7263, 7645
   - **STATUS:** ✅ Only used in draft mode

5. **`window.draftClipPickerCandidates`** (array)
   - Set: Line 7110, 7713
   - Used: Line 7153, 7392, 7650
   - **STATUS:** ✅ Only used in draft mode

6. **`window.clipPickerPagination`** (object, session mode only)
   - Set: Line 7130, 7546, 7600, 7601
   - Used: Line 7160, 7214, 7231, 7252, 7266, 7348, 7615
   - **STATUS:** ✅ Only used in session mode

**Summary:**
- ✅ State variables are properly separated (draft vs session)
- ✅ Variables are cleared when picker closes
- ⚠️ **RISK:** `clipPickerSentenceIndex` uses numeric index - needs to become `clipPickerBeatId` (string) for Phase 1

---

## 5. Backend Session Creation & Render Pipeline

### Session Creation (`src/routes/story.routes.js:561-646`)

**Current Validation:**
- Line 572: Schema requires exactly 8 beats (`.length(8)`)
- Line 588-594: Validates "at least one beat has content"
- Line 610: Maps ALL beats to sentences (including empty ones)
- Line 614-622: Maps ALL beats to shots (including empty ones)

**RISK:** Empty/placeholder beats are included in session, which could cause issues in render.

### Render Pipeline (`src/services/story.service.js:743-1042`)

**Current Validation:**
- Line 746-748: Requires `session.shots` and `session.captions`
- Line 750-753: Filters to `shotsWithClips = session.shots.filter(s => s.selectedClip?.url)`
- Line 751: Throws if `shotsWithClips.length === 0`

**STATUS:** ✅ Render already filters out beats without clips. However, it still processes beats with empty text if they have clips.

**RISK:** If a beat has a clip but empty/placeholder text, it will render with empty caption (may cause issues).

---

## 6. Additional Findings

### Missing Validation Functions

No existing `isPlaceholderText()`, `hasText()`, or `hasClip()` helper functions found.

### Draft Storyboard Structure

Current structure:
```javascript
window.draftStoryboard = {
    beats: Array(8).fill(null).map(() => ({ 
        text: '', 
        selectedClip: null 
    }))
}
```

**Needs to become:**
```javascript
window.draftStoryboard = {
    beats: [{ 
        id: generateBeatId(), 
        text: '', 
        selectedClip: null 
    }]
}
```

### Index vs ID Usage

**Current:** All draft beat operations use numeric `sentenceIndex` (0-7)
- `renderDraftStoryboard()`: Line 6566 - `beats.forEach((beat, idx) => ...)`
- `openClipPicker()`: Line 7108 - `window.clipPickerSentenceIndex = sentenceIndex`
- `handleClipOptionClick()`: Line 7382 - uses `sentenceIndex`
- `handleEditBeatInline()`: Line 6876 - uses `sentenceIndex`
- `commitBeatTextEdit()`: Line 6933 - uses `sentenceIndex`

**RISK:** All these need to switch to `beatId` (string) for Phase 1.

---

## 7. Risk Assessment

### High Risk (Must Fix)

1. **Backend schema `.length(8)` constraint** - Will break with dynamic beats
2. **10 frontend `Array(8)` initializations** - Must change to 1 beat
3. **Index-based beat identification** - Must switch to stable IDs
4. **No placeholder text validation** - Empty beats may pass through

### Medium Risk (Should Fix)

1. **Clip picker uses `sentenceIndex` in draft mode** - Needs `beatId`
2. **Session creation includes all beats** - Should filter invalid beats first

### Low Risk (Nice to Have)

1. **Render pipeline already filters** - But could be more explicit about text validation

---

## 8. Recommendations

### Phase 0 (Safety Net)

1. ✅ Add `isPlaceholderText(text)` helper function
2. ✅ Filter beats in `ensureSessionFromDraft()` before API call
3. ✅ Update backend schema to accept variable-length array (max 8)
4. ✅ Filter invalid beats in backend before creating session
5. ✅ Add validation: require both text AND clip for valid beat

### Phase 1 (Dynamic Beats)

1. ✅ Change all `Array(8)` to single beat with ID
2. ✅ Add `generateBeatId()` helper
3. ✅ Update all index-based operations to use `beatId`
4. ✅ Update clip picker to use `clipPickerBeatId` instead of `clipPickerSentenceIndex`
5. ✅ Add delete button to draft beats
6. ✅ Add "+ Add beat" button (cap at 8)
7. ✅ Update `renderDraftStoryboard()` to use IDs

---

## Conclusion

**Status: RISKS FOUND - Safe to proceed with caution**

All identified risks are addressable. The main work is:
1. Remove `.length(8)` constraint from backend schema
2. Replace all `Array(8)` initializations with single beat
3. Switch from index-based to ID-based beat identification
4. Add placeholder text validation

The clip picker state management is already well-separated between draft and session modes, making the ID migration straightforward.

