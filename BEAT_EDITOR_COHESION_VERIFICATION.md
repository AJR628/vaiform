# Beat Editor Phase 2 Cohesion Verification Report

**Date**: 2025-01-XX  
**File**: `public/creative.html`  
**Purpose**: Verify cohesion before implementing Phase 2 fixes

---

## 1) #beat-list Children Verification

**Status**: ⚠️ **NEEDS IMPROVEMENT**

**Current Implementation**:
- `#beat-list` is cleared with `beatList.innerHTML = ''` (line 6538)
- Beat rows are created as `<div>` elements with class: `'flex items-start gap-2 p-2 bg-gray-50 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded'` (line 6543)
- No `.beat-row` class exists

**Issue**: 
- `updateBeatInTextarea()` uses `Array.from(beatList.children)` which will include ANY children
- If other elements are accidentally added, they'll be included in beat collection

**Fix Required**: Add `.beat-row` class to beat rows and query by that:
```javascript
// In renderBeatEditor(), line 6543:
beatRow.className = 'beat-row flex items-start gap-2 p-2 bg-gray-50 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded';

// In updateBeatInTextarea(), line 6647:
const beatRows = Array.from(beatList.querySelectorAll('.beat-row'));
```

---

## 2) textarea.value Assignment Guard Verification

**Status**: ❌ **CRITICAL BUG FOUND**

**All Assignments Found**:

1. **Line 6381** (`syncTextareaFromBeats()`):
   ```javascript
   window._syncingTextarea = true;
   textarea.value = text;
   setTimeout(() => { window._syncingTextarea = false; }, 0);
   ```
   ✅ **GUARDED**

2. **Line 6676** (Apply callback in `toggleViewMode()`):
   ```javascript
   window._syncingTextarea = true;
   textarea.value = parseResult.normalizedText;
   setTimeout(() => { window._syncingTextarea = false; }, 0);
   ```
   ✅ **GUARDED**

3. **Line 6756** (`handleAddBeat()`):
   ```javascript
   window._syncingTextarea = true;
   textarea.value = newValue;
   setTimeout(() => { window._syncingTextarea = false; }, 0);
   ```
   ✅ **GUARDED**

4. **Line 6876** (`summarizeArticle()`):
   ```javascript
   window._syncingTextarea = true;
   scriptPreviewEl.value = scriptText;
   setTimeout(() => { window._syncingTextarea = false; }, 0);
   ```
   ✅ **GUARDED**

5. **Line 7024** (`prepareStoryboard()` Priority 2):
   ```javascript
   const normalizedText = normalizedBeats.join('\n');
   scriptPreviewEl.value = normalizedText;
   // NO GUARD!
   ```
   ❌ **NOT GUARDED - CRITICAL BUG**

**Fix Required**: Add guard to line 7024:
```javascript
window._syncingTextarea = true;
scriptPreviewEl.value = normalizedText;
setTimeout(() => { window._syncingTextarea = false; }, 0);
```

---

## 3) split('\n') Empty Filtering Consistency

**Status**: ✅ **ALL CONSISTENT**

**All Relevant Splits Found**:

1. **Line 6253** (`normalizeScript()`):
   ```javascript
   let beats = originalText.split('\n')
       .map(s => s.trim())
       .filter(s => s.length > 0);
   ```
   ✅ **FILTERS EMPTIES**

2. **Line 6349** (`updateScriptCounters()`):
   ```javascript
   const beats = text.split('\n')
       .map(s => s.trim())
       .filter(s => s.length > 0);
   ```
   ✅ **FILTERS EMPTIES**

3. **Line 6394** (`parseBeatsFromTextarea()`):
   ```javascript
   return text.split('\n')
       .map(s => s.trim())
       .filter(s => s.length > 0)
       .map((text, idx) => ({ id: `beat-${idx}`, text }));
   ```
   ✅ **FILTERS EMPTIES**

4. **Line 6407** (`willApplyChangeText()`):
   ```javascript
   const originalBeats = rawText.split('\n')
       .map(s => s.trim())
       .filter(s => s.length > 0);
   ```
   ✅ **FILTERS EMPTIES**

5. **Line 6943** (`prepareStoryboard()` Priority 1):
   ```javascript
   const currentSentences = scriptText.split('\n')
       .map(s => s.trim())
       .filter(s => s.length > 0);
   ```
   ✅ **FILTERS EMPTIES**

**Result**: All splits filter empties consistently. ✅

---

## 4) add-beat Button Disabled State

**Status**: ✅ **ONLY ONE PLACE**

**Found**: Only set in `renderBeatEditor()` at line 6631:
```javascript
if (addBeatBtn) {
    addBeatBtn.disabled = beats.length >= MAX_BEATS;
}
```

**Result**: No other assignments found. ✅

---

## 5) updateBeatInTextarea() Call Sites

**Status**: ⚠️ **CALLED ON INPUT - NEEDS STRATEGY**

**Call Sites Found**:

1. **Line 6601** (Paste event handler):
   ```javascript
   input.addEventListener('paste', (e) => {
       // ... sanitize paste ...
       updateBeatInTextarea(beat.id, newValue);
   });
   ```
   ⚠️ **CALLED ON PASTE**

2. **Line 6618** (Input event handler):
   ```javascript
   input.addEventListener('input', () => {
       const newValue = input.value;
       // ... update char counter ...
       updateBeatInTextarea(beat.id, newValue);
   });
   ```
   ⚠️ **CALLED ON EVERY INPUT**

**Problem**: 
- If `updateBeatInTextarea()` filters empty beats immediately, user typing will see beat disappear mid-edit
- Example: User deletes all text in beat 2 → beat disappears → user loses focus → confusing UX

**Proposed Solution**: 
- **Option A (Recommended)**: Don't filter empties in `updateBeatInTextarea()` when called from input events. Only filter on commit (blur/Enter).
- **Option B**: Keep current behavior (filter immediately) but add visual feedback (gray out empty beat, show "will be removed" message).
- **Option C**: Debounce filtering - only filter after user stops typing for 500ms.

**Recommendation**: **Option A** - Modify `updateBeatInTextarea()` to accept optional `filterEmpties` parameter:
```javascript
function updateBeatInTextarea(beatId, newText, filterEmpties = false) {
    const beatList = document.getElementById('beat-list');
    if (!beatList) return;
    
    const beatRows = Array.from(beatList.querySelectorAll('.beat-row'));
    let beats = beatRows.map(row => {
        const input = row.querySelector('input');
        return input ? input.value.trim() : '';
    });
    
    // Only filter empties if explicitly requested (on commit)
    if (filterEmpties) {
        beats = beats.filter(text => text.length > 0);
    }
    
    syncTextareaFromBeats(beats);
    
    // Only re-render if filtering empties (commit) or if in beats view and not mid-edit
    if (filterEmpties && currentViewMode === 'beats') {
        renderBeatEditor();
    }
}
```

Then:
- Input event: `updateBeatInTextarea(beat.id, newValue, false)` - no filtering, no re-render
- Blur/Enter event: `updateBeatInTextarea(beat.id, newValue, true)` - filter and re-render

---

## Summary

| Check | Status | Action Required |
|-------|--------|----------------|
| 1. #beat-list children | ⚠️ Needs improvement | Add `.beat-row` class and query by that |
| 2. textarea.value guards | ❌ Critical bug | Add guard to line 7024 in `prepareStoryboard()` |
| 3. split('\n') filtering | ✅ Consistent | None |
| 4. add-beat disabled | ✅ Single source | None |
| 5. updateBeatInTextarea calls | ⚠️ Needs strategy | Add `filterEmpties` parameter, only filter on commit |

---

## Updated Fix Plan

**Additional Fixes Required**:
1. Add `.beat-row` class to beat rows (line 6543)
2. Update `updateBeatInTextarea()` to use `.beat-row` selector (line 6647)
3. Add guard to `prepareStoryboard()` textarea assignment (line 7024)
4. Modify `updateBeatInTextarea()` to accept `filterEmpties` parameter
5. Update input handler to call with `filterEmpties = false`
6. Update blur/Enter handlers to call with `filterEmpties = true`

**Original Fixes Still Required**:
- Fix rawDraftText assignment (line 6686)
- Add banner cleanup in `summarizeArticle()` (after line 6883)
- Fix Enter key to commit and blur (lines 6574-6578)

