# Beat Editor Phase 2 Fixes - Updated Plan

**Based on**: Cohesion Verification Report  
**File**: `public/creative.html`  
**Status**: Ready for implementation

---

## Cohesion Verification Results

### ✅ Passed Checks
1. **split('\n') filtering**: All 5 locations filter empties consistently
2. **add-beat button disabled**: Only set in one place (renderBeatEditor)

### ❌ Critical Issues Found
1. **textarea.value guard missing**: Line 7024 in `prepareStoryboard()` NOT guarded
2. **#beat-list children**: No `.beat-row` class, unsafe query
3. **updateBeatInTextarea() called on input**: Filters empties mid-typing (bad UX)

---

## Implementation Plan

### Fix 1: Add .beat-row Class for Safe Querying

**Location**: Line 6543 in `renderBeatEditor()`

**Change**:
```javascript
// Current:
beatRow.className = 'flex items-start gap-2 p-2 bg-gray-50 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded';

// Fix:
beatRow.className = 'beat-row flex items-start gap-2 p-2 bg-gray-50 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded';
```

**Location**: Line 6647 in `updateBeatInTextarea()`

**Change**:
```javascript
// Current:
const beatRows = Array.from(beatList.children);

// Fix:
const beatRows = Array.from(beatList.querySelectorAll('.beat-row'));
```

---

### Fix 2: Add Guard to prepareStoryboard() textarea Assignment

**Location**: Line 7024 in `prepareStoryboard()` Priority 2

**Change**:
```javascript
// Current:
const normalizedText = normalizedBeats.join('\n');
scriptPreviewEl.value = normalizedText;

// Fix:
const normalizedText = normalizedBeats.join('\n');
window._syncingTextarea = true;
scriptPreviewEl.value = normalizedText;
setTimeout(() => {
    window._syncingTextarea = false;
}, 0);
```

---

### Fix 3: Fix rawDraftText Assignment in Apply Callback

**Location**: Line 6686 in `toggleViewMode()` Apply callback

**Change**:
```javascript
// Current:
window.rawDraftText = '';

// Fix:
window.rawDraftText = textarea.value;
```

---

### Fix 4: Add Banner Cleanup in summarizeArticle()

**Location**: After line 6883 in `summarizeArticle()`

**Change**: Add after clearing raw draft state:
```javascript
// Phase 2: Clear raw draft state
window.rawDirty = false;
window.rawDraftText = '';

// Phase 2: Remove any pending confirm banner
const existingBanner = document.getElementById('beat-apply-confirm');
if (existingBanner) {
    existingBanner.remove();
}
window.pendingBeatParseResult = null;
```

---

### Fix 5: Fix updateBeatInTextarea() with filterEmpties Parameter

**Location**: Lines 6642-6655 in `updateBeatInTextarea()`

**Strategy**: Add `filterEmpties` parameter to control when empty beats are filtered:
- `filterEmpties = false` (default): Don't filter, preserve empty beats during typing
- `filterEmpties = true`: Filter empty beats on commit (blur/Enter)

**Change**:
```javascript
// Current:
function updateBeatInTextarea(beatId, newText) {
    const beatList = document.getElementById('beat-list');
    if (!beatList) return;
    
    // Collect all beat values in order
    const beatRows = Array.from(beatList.children);
    const beats = beatRows.map(row => {
        const input = row.querySelector('input');
        return input ? input.value : '';
    });
    
    // Sync to textarea
    syncTextareaFromBeats(beats);
}

// Fix:
function updateBeatInTextarea(beatId, newText, filterEmpties = false) {
    const beatList = document.getElementById('beat-list');
    if (!beatList) return;
    
    // Collect all beat values in order (use .beat-row selector)
    const beatRows = Array.from(beatList.querySelectorAll('.beat-row'));
    let beats = beatRows.map(row => {
        const input = row.querySelector('input');
        return input ? input.value.trim() : '';
    });
    
    // Only filter empty beats if explicitly requested (on commit)
    if (filterEmpties) {
        beats = beats.filter(text => text.length > 0);
    }
    
    // Sync to textarea (guarded)
    syncTextareaFromBeats(beats);
    
    // Only re-render if filtering empties (commit) to update numbering
    if (filterEmpties && currentViewMode === 'beats') {
        renderBeatEditor();
    }
}
```

**Update call sites**:

1. **Line 6601** (Paste handler):
   ```javascript
   // Current:
   updateBeatInTextarea(beat.id, newValue);
   
   // Fix:
   updateBeatInTextarea(beat.id, newValue, false); // Don't filter on paste
   ```

2. **Line 6618** (Input handler):
   ```javascript
   // Current:
   updateBeatInTextarea(beat.id, newValue);
   
   // Fix:
   updateBeatInTextarea(beat.id, newValue, false); // Don't filter on input
   ```

3. **Add blur handler** (after line 6619):
   ```javascript
   // Add blur event to commit with filtering
   input.addEventListener('blur', () => {
       const newValue = input.value.trim();
       updateBeatInTextarea(beat.id, newValue, true); // Filter on blur (commit)
   });
   ```

---

### Fix 6: Fix Enter Key to Commit and Blur

**Location**: Lines 6574-6578 in `renderBeatEditor()` Enter key handler

**Change**:
```javascript
// Current:
input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
        e.preventDefault();
    }
});

// Fix:
input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
        e.preventDefault();
        // Commit: trigger update with filtering
        const newValue = input.value.trim();
        updateBeatInTextarea(beat.id, newValue, true); // Filter on Enter (commit)
        // Blur to signal save
        input.blur();
    }
});
```

---

## Implementation Order

1. **Fix 1**: Add `.beat-row` class (line 6543) and update selector (line 6647)
2. **Fix 2**: Add guard to `prepareStoryboard()` (line 7024)
3. **Fix 3**: Fix rawDraftText assignment (line 6686)
4. **Fix 4**: Add banner cleanup (after line 6883)
5. **Fix 5**: Update `updateBeatInTextarea()` with `filterEmpties` parameter
6. **Fix 6**: Update call sites (lines 6601, 6618) and add blur handler
7. **Fix 7**: Fix Enter key handler (lines 6574-6578)

---

## Summary of Changes

**File**: `public/creative.html`  
**Total Changes**: 7 fixes across 8 locations

1. Line 6543: Add `.beat-row` class to beat rows
2. Line 6647: Update selector to use `.beat-row`
3. Line 7024: Add guard to textarea assignment
4. Line 6686: Fix rawDraftText assignment
5. After line 6883: Add banner cleanup
6. Lines 6642-6655: Refactor `updateBeatInTextarea()` with `filterEmpties`
7. Lines 6601, 6618: Update call sites to use `filterEmpties = false`
8. After line 6619: Add blur handler with `filterEmpties = true`
9. Lines 6574-6578: Fix Enter key to commit and blur

---

## Smoke Tests

After implementation, verify:

1. ✅ **Add Beat enabled/disabled**: With 3 beats → enabled. With 8 beats → disabled.
2. ✅ **Add Beat creates new beat**: Click → beat 04 appears (empty).
3. ✅ **Edit beat + Enter commits**: Edit beat 2, press Enter → text persists, empty beats filtered, raw view reflects it.
4. ✅ **Edit beat + blur commits**: Edit beat 2, click away → text persists, empty beats filtered.
5. ✅ **Paste multi-line sanitized**: Paste `"A\nB"` into beat → becomes `"A B"`.
6. ✅ **Empty beat filtered on commit**: Delete all text in beat 2, press Enter or blur → beat list re-renders, numbering updates (1, 2, 3 → 1, 2), Add Beat enables if < MAX.
7. ✅ **Empty beat NOT filtered mid-typing**: Delete all text in beat 2, keep typing → beat stays visible until blur/Enter.
8. ✅ **Prepare storyboard unchanged**: Reads textarea, `normalizeScript()` at same checkpoint, guard prevents scriptSource flip.

