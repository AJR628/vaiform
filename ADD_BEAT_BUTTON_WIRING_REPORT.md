# "+ Add beat" Button Wiring Report

**Issue**: Button stays disabled even when beats < MAX_BEATS  
**Date**: 2025-01-XX  
**Status**: Read-only audit complete

---

## A) Wiring Map

### 1. DOM + Markup

**Button Element** (`public/creative.html:977-982`):
- **Tag**: `<button>`
- **ID**: `id="add-beat-btn"`
- **Type**: `type="button"` ✅ (not submit)
- **Default classes**: `text-xs px-2 py-1 bg-gray-600 hover:bg-gray-500 disabled:bg-gray-400 disabled:cursor-not-allowed rounded text-white`
- **Disabled attribute**: Not set in HTML (defaults to `false`)
- **Location**: Inside `#beat-editor` div (line 973)
- **Wrapper**: `#beat-editor` has class `hidden` by default (line 973)
- **Form context**: Not inside a `<form>` element

**Visibility**:
- Button is inside `#beat-editor` which starts with `class="hidden"` (line 973)
- Button is only visible when `currentViewMode === 'beats'` (beat-editor shown, textarea hidden)
- Button is NOT visible in raw mode (beat-editor hidden)

---

### 2. Event Wiring

**Handler Attachment** (`public/creative.html:6804-6826`):
- **Location**: IIFE that runs on page load (lines 6800-6827)
- **Method**: `addEventListener('click', handleAddBeat)`
- **Conditional**: Only attaches if `addBeatBtn` element exists
- **Timing**: 
  - If `document.readyState === 'loading'`: Waits for `DOMContentLoaded`
  - Else: Attaches immediately
- **No delegation**: Direct handler attachment, not via router
- **No inline onclick**: Uses addEventListener

**Handler Function** (`public/creative.html:6770-6798`):
- **Name**: `handleAddBeat()`
- **Guard**: Checks `parseBeatsFromTextarea(textarea.value).length >= MAX_BEATS` before proceeding
- **Action**: Adds newline to textarea, updates counters, calls `renderBeatEditor()` if in beats view
- **No preventDefault/stopPropagation**: Standard click handler

**Proposed Debug Location**:
- Add `console.log('[add-beat] Click fired, beats:', parseBeatsFromTextarea(textarea.value).length)` at line 6771 (start of `handleAddBeat()`)
- Add `console.log('[add-beat] Button disabled state:', addBeatBtn.disabled)` at line 6651 (in `renderBeatEditor()`)

---

### 3. State + Conditions

**Disabled State Setter** (`public/creative.html:6650-6652`):
- **Only location**: Inside `renderBeatEditor()` function
- **Line**: 6651
- **Code**: `addBeatBtn.disabled = beats.length >= MAX_BEATS;`
- **Condition**: Only sets if `addBeatBtn` exists (line 6650)

**Beats Count Source** (`public/creative.html:6543`):
- **Function**: `parseBeatsFromTextarea(textarea.value)`
- **Definition** (`public/creative.html:6393-6398`):
  ```javascript
  function parseBeatsFromTextarea(text) {
      return text.split('\n')
          .map(s => s.trim())
          .filter(s => s.length > 0)  // Filters empty lines
          .map((text, idx) => ({ id: `beat-${idx}`, text }));
  }
  ```
- **SSOT**: Uses `textarea.value` (not `session.story.sentences`)
- **Filtering**: ✅ Filters empty lines (consistent with other parsers)

**MAX_BEATS Definition** (`public/creative.html:6220`):
- **Value**: `const MAX_BEATS = 8;`
- **Scope**: Module-level constant (accessible everywhere in script)

**Button State Logic**:
- `disabled = true` when `beats.length >= 8`
- `disabled = false` when `beats.length < 8`

---

### 4. Render Lifecycle / Stale State

**When `renderBeatEditor()` Runs**:

1. **On toggle to beats view** (`public/creative.html:6728, 6747`):
   - Line 6728: After Apply & Switch (with normalization)
   - Line 6747: After immediate switch (no normalization needed)
   - ✅ **Button state updated**

2. **On `handleAddBeat()`** (`public/creative.html:6796`):
   - Only if `currentViewMode === 'beats'`
   - ✅ **Button state updated after adding beat**

3. **On `summarizeArticle()`** (`public/creative.html:6933`):
   - Only if `currentViewMode === 'beats'`
   - ✅ **Button state updated after LLM generation**

4. **On textarea input** (`public/creative.html:9374`):
   - Only if `currentViewMode === 'beats'`
   - ✅ **Button state updated on textarea changes**

5. **On `updateBeatInTextarea()` commit** (`public/creative.html:6683`):
   - Only if `filterEmpties === true` AND `currentViewMode === 'beats'`
   - ✅ **Button state updated when empty beats filtered**

**When `renderBeatEditor()` Does NOT Run**:

1. **On page load** (if `currentViewMode === 'raw'`):
   - Default: `currentViewMode = 'raw'` (line 6364)
   - `#beat-editor` has `class="hidden"` (line 973)
   - ❌ **Button state never initialized** (but button is hidden, so not visible issue)

2. **On toggle to raw view**:
   - `#beat-editor` gets `class="hidden"` added (line 6753)
   - ❌ **Button state not updated** (but button is hidden, so not visible issue)

3. **On `handleAddBeat()` in raw mode**:
   - Line 6795: `if (currentViewMode === 'beats')` guard
   - ❌ **Button state not updated** (but button is hidden in raw mode)

**Stale State Scenarios**:

1. **User toggles to beats view with empty textarea**:
   - `parseBeatsFromTextarea('')` returns `[]` (0 beats)
   - `beats.length = 0 < 8` → `disabled = false` ✅
   - **Should be enabled** ✅

2. **User toggles to beats view with 3 beats**:
   - `parseBeatsFromTextarea(textarea.value)` returns 3 beats
   - `beats.length = 3 < 8` → `disabled = false` ✅
   - **Should be enabled** ✅

3. **User adds beat via textarea in raw mode, then toggles to beats**:
   - Textarea has newline → `parseBeatsFromTextarea()` counts it
   - `renderBeatEditor()` runs on toggle → button state updated ✅
   - **Should work correctly** ✅

4. **User deletes all text from a beat in beats view, doesn't commit**:
   - Beat input has empty value
   - `updateBeatInTextarea()` called with `filterEmpties = false` (line 6618)
   - Empty beat NOT filtered → textarea has empty line
   - `renderBeatEditor()` NOT called (line 6682 guard)
   - Button state NOT updated until commit
   - ⚠️ **Potential stale state if beat count changes**

5. **User deletes all text from a beat, then commits (blur/Enter)**:
   - `updateBeatInTextarea()` called with `filterEmpties = true`
   - Empty beat filtered → beat count decreases
   - `renderBeatEditor()` called (line 6683)
   - Button state updated ✅
   - **Should work correctly** ✅

---

### 5. CSS "Greyed Out" Analysis

**Disabled Styling** (`public/creative.html:979`):
- **Tailwind classes**: `disabled:bg-gray-400 disabled:cursor-not-allowed`
- **Behavior**: Applied when `disabled` attribute is `true`
- **Visual**: Grey background, not-allowed cursor

**No Additional CSS**:
- No `pointer-events-none` on button
- No overlay blocking clicks
- No z-index issues
- No opacity classes that would grey it out without disabling

**Conclusion**: Button appearance matches `disabled` attribute state. If it looks grey, it IS disabled.

---

## B) Repro Notes

### Mode Analysis

**Raw Mode**:
- `#beat-editor` has `class="hidden"` (line 6752)
- Button is not visible (hidden by parent)
- Button state is irrelevant (user can't see/click it)
- ✅ **Not an issue in raw mode**

**Beats Mode**:
- `#beat-editor` has `class="hidden"` removed (line 6722, 6737)
- Button is visible
- Button state should reflect `beats.length < MAX_BEATS`
- ❌ **Issue occurs here**

### Beats Count at Disabled Moment

**Expected Behavior**:
- If `beats.length = 0-7`: Button should be `disabled = false` (enabled)
- If `beats.length = 8`: Button should be `disabled = true` (disabled)

**Actual Behavior** (hypothesis):
- Button may be `disabled = true` even when `beats.length < 8`
- Possible causes:
  1. `renderBeatEditor()` never ran after toggle to beats view
  2. `beats.length` calculation is wrong (includes empties somehow)
  3. Button was disabled elsewhere (no evidence found)
  4. Initial state is disabled (HTML default is `false`, but browser may cache)

---

## C) Root Cause Analysis

### Most Likely Root Cause: **Stale Initial State**

**Evidence**:
1. Button `disabled` attribute is only set in `renderBeatEditor()` (line 6651)
2. `renderBeatEditor()` only runs when:
   - Toggling to beats view (lines 6728, 6747)
   - Adding beat in beats view (line 6796)
   - Other beats view operations
3. **BUT**: If user toggles to beats view and `renderBeatEditor()` fails silently (e.g., `addBeatBtn` is null, or early return), button state is never set
4. **OR**: If `renderBeatEditor()` runs but `addBeatBtn` is null (element not found), state is not set

**Secondary Hypothesis: Early Return in renderBeatEditor()**

**Evidence**:
- `renderBeatEditor()` has early return at line 6540:
  ```javascript
  if (!beatEditor || !beatList || !textarea) return;
  ```
- If `addBeatBtn` is null but other elements exist, function continues
- Button state setter at line 6650 checks `if (addBeatBtn)` before setting
- **BUT**: If `addBeatBtn` is null, state is never set, button stays in default state

**Tertiary Hypothesis: Beats Count Calculation Issue**

**Evidence**:
- `parseBeatsFromTextarea()` filters empties correctly
- BUT: If textarea has empty lines that aren't filtered (edge case), count could be wrong
- **Unlikely**: `parseBeatsFromTextarea()` always filters empties

---

## D) Smallest Safe Fix Plan

### Fix 1: Ensure Button State is Set on Toggle

**Problem**: If `renderBeatEditor()` fails or `addBeatBtn` is null, button state never initializes.

**Fix**: Add explicit button state update in `toggleViewMode()` after showing beat-editor:

**Location**: `public/creative.html:6737` (after `beatEditor.classList.remove('hidden')`)

**Change**:
```javascript
// After line 6737 (beatEditor.classList.remove('hidden'))
// Ensure button state is set even if renderBeatEditor() fails
const addBeatBtn = document.getElementById('add-beat-btn');
if (addBeatBtn) {
    const beats = parseBeatsFromTextarea(textarea.value);
    addBeatBtn.disabled = beats.length >= MAX_BEATS;
}
```

**Also apply to**: Line 6722 (Apply & Switch path)

**Rationale**: Guarantees button state is set when beat-editor becomes visible, even if `renderBeatEditor()` has issues.

---

### Fix 2: Add Safety Check in renderBeatEditor()

**Problem**: If `addBeatBtn` is null, state is never set, but function doesn't fail.

**Fix**: Add explicit check and log if button not found:

**Location**: `public/creative.html:6536` (where `addBeatBtn` is retrieved)

**Change**:
```javascript
const addBeatBtn = document.getElementById('add-beat-btn');
if (!addBeatBtn) {
    console.warn('[beat-editor] add-beat-btn not found');
    return; // Or continue without setting button state
}
```

**Rationale**: Fails fast if button element is missing, preventing silent failures.

---

### Fix 3: Initialize Button State on Page Load (Optional)

**Problem**: If page loads with beats view active (unlikely but possible), button state is never initialized.

**Fix**: Add initialization check after DOM ready:

**Location**: After line 6827 (end of IIFE that attaches handlers)

**Change**:
```javascript
// Initialize button state if beat-editor is visible on page load
if (document.getElementById('beat-editor') && !document.getElementById('beat-editor').classList.contains('hidden')) {
    const addBeatBtn = document.getElementById('add-beat-btn');
    if (addBeatBtn) {
        const textarea = document.getElementById('article-script-preview');
        if (textarea) {
            const beats = parseBeatsFromTextarea(textarea.value);
            addBeatBtn.disabled = beats.length >= MAX_BEATS;
        }
    }
}
```

**Rationale**: Handles edge case where beat-editor is visible on page load.

---

### Fix 4: Add Debug Logging (Temporary)

**Location**: `public/creative.html:6651` (in `renderBeatEditor()`)

**Change**:
```javascript
if (addBeatBtn) {
    const wasDisabled = addBeatBtn.disabled;
    addBeatBtn.disabled = beats.length >= MAX_BEATS;
    console.log('[beat-editor] Button state:', {
        beatsCount: beats.length,
        maxBeats: MAX_BEATS,
        wasDisabled,
        nowDisabled: addBeatBtn.disabled
    });
}
```

**Rationale**: Helps diagnose if button state is being set correctly.

---

## Safety Notes

### Session Mode Consideration

**Question**: Should Add Beat be disabled when `window.currentStorySession` exists?

**Current Behavior**: No check for session existence. Button state only depends on beat count.

**Recommendation**: 
- **Phase 2**: Keep current behavior (allow adding beats before storyboard creation)
- **Future**: After storyboard creation, Add Beat should be disabled with explanation: "Cannot add beats after storyboard is created. Delete storyboard to edit beats."

**Rationale**: 
- `sentenceIndex` alignment must be preserved after storyboard creation
- Adding beats after storyboard would break `sentenceIndex` mapping
- User should delete storyboard to edit beats

---

## Summary

**Root Cause**: Most likely **stale initial state** - button state is only set in `renderBeatEditor()`, which may not run or may fail silently if `addBeatBtn` is null.

**Smallest Safe Fix**: 
1. Add explicit button state update in `toggleViewMode()` after showing beat-editor (Fix 1)
2. Add safety check in `renderBeatEditor()` to fail fast if button missing (Fix 2)

**Files to Modify**: `public/creative.html` only (2 locations)

**Risk Level**: Low (additive changes, no refactoring)




