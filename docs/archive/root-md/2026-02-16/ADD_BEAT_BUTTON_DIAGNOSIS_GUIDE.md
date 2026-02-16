# "+ Add beat" Button Diagnosis Guide

**Status**: Temporary logs added, ready for reproduction  
**File**: `public/creative.html`

---

## Logs Added

### 1. renderBeatEditor() Logs (lines 6649-6683)

**Before setting disabled**:
- `currentViewMode`
- `hasSession: !!window.currentStorySession`
- `textareaLineCount`: Raw line count from textarea
- `parsedBeatsCount`: Count after filtering empties
- `parsedBeatsTexts`: Array of beat text strings (JSON stringified)
- `beatsLength`: The `beats` array length used for comparison
- `buttonDisabledBefore`: State before update
- `maxBeats`: MAX_BEATS constant value
- `buttonElementCount`: Number of elements with id="add-beat-btn" (should be 1)

**After setting disabled**:
- `buttonDisabledAfter`: State after update
- `visibleBeatRows`: Number of `.beat-row` elements in DOM
- `beatsLength`: Confirmation of beats array length
- `condition`: The actual comparison `${beats.length} >= ${MAX_BEATS} = ${result}`

### 2. handleAddBeat() Logs (lines 6770-6800)

**At start**:
- `[TEMP-DIAG handleAddBeat] Click fired`

**State check**:
- `hasSession`
- `parsedBeatsCount`
- `buttonDisabled`: Current disabled state
- `maxBeats`
- `textareaValue`: Full textarea content
- `textareaLines`: Array of all lines (including empties)

**Early return logs**:
- If textarea not found: `EARLY RETURN: textarea not found`
- If at max beats: `EARLY RETURN: at max beats` with counts

---

## Reproduction Steps

1. **Load the page** in browser
2. **Open browser console** (F12 → Console tab)
3. **Clear console** to start fresh
4. **Set up scenario**:
   - Option A: Start with empty textarea, toggle to Beats view
   - Option B: Add some beats (but < 8), toggle to Beats view
   - Option C: If you have a specific scenario where button is grey but should be enabled, reproduce that
5. **Toggle to Beats view** (click "Beat View" button)
6. **Observe console logs** - you should see `[TEMP-DIAG renderBeatEditor]` logs
7. **If button is grey**, try clicking it - you should see `[TEMP-DIAG handleAddBeat]` logs
8. **Copy all console output** that starts with `[TEMP-DIAG`

---

## What to Look For

### Root Cause A: parsedBeatsCount >= 8
**Evidence**:
- `parsedBeatsCount` shows 8 or more
- `visibleBeatRows` shows fewer than 8
- `parsedBeatsTexts` array shows hidden non-empty lines

**Action**: Identify why textarea has more beats than visible

### Root Cause B: parsedBeatsCount < 8 but disabled = true
**Evidence**:
- `parsedBeatsCount` shows < 8
- `buttonDisabledAfter` shows `true`
- `beatsLength` might differ from `parsedBeatsCount`

**Action**: Check if `beats.length` (used in comparison) differs from parsed count

### Root Cause C: disabled = false but UI looks grey
**Evidence**:
- `buttonDisabledAfter` shows `false`
- Button still appears grey in UI
- `buttonElementCount` might be > 1 (wrong element being styled)

**Action**: Check for multiple elements or CSS issues

---

## Expected Console Output Format

```
[TEMP-DIAG renderBeatEditor] BEFORE setting disabled: {
  currentViewMode: "beats",
  hasSession: false,
  textareaLineCount: 3,
  parsedBeatsCount: 3,
  parsedBeatsTexts: ["\"Beat 1\"", "\"Beat 2\"", "\"Beat 3\""],
  beatsLength: 3,
  buttonDisabledBefore: true,
  maxBeats: 8,
  buttonElementCount: 1
}
[TEMP-DIAG renderBeatEditor] AFTER setting disabled: {
  buttonDisabledAfter: false,
  visibleBeatRows: 3,
  beatsLength: 3,
  condition: "3 >= 8 = false"
}
```

---

## Next Steps

1. **Reproduce the issue** following steps above
2. **Copy console output** (all `[TEMP-DIAG` logs)
3. **Paste output** in response
4. **Analysis will determine** root cause (A/B/C)
5. **Propose minimal fix** based on evidence
6. **Remove temp logs** after diagnosis

---

## Notes

- Logs are marked with `[TEMP-DIAG` prefix for easy filtering
- All logs use `console.log` (not `console.error`) so they're easy to copy
- If button is not visible, check if `#beat-editor` has `hidden` class
- If no logs appear, `renderBeatEditor()` may not be running

