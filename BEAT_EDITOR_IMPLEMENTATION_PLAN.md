# Beat Editor Implementation Plan

**Date**: 2025-01-XX  
**Purpose**: Implementation plan for adding Beat Editor to Script Preview  
**Status**: PLAN ONLY - No Code Changes  
**Based on**: `SCRIPT_PREVIEW_SSOT_AUDIT.md` + `SCRIPT_PREVIEW_VERIFICATION_AUDIT.md`

---

## 1) CURRENT STATE MAP

### Script Generation → Textarea Population

**File**: `public/creative.html:6340-6432` (`summarizeArticle()`)

**Exact flow**:
- Line 6404-6408: Validates response has `generateResp.data?.story?.sentences`
- Line 6411: Extracts `sentences = generateResp.data.story.sentences` (array)
- Line 6412: Joins array: `scriptText = Array.isArray(sentences) ? sentences.join('\n') : String(sentences)`
- Line 6413: Writes to textarea: `scriptPreviewEl.value = scriptText`
- Line 6416: Stores original: `window.currentStoryOriginalSentences = Array.isArray(sentences) ? [...sentences] : [String(sentences)]`
- Line 6419: Sets flag: `window.scriptSource = 'llm'`
- Line 6422: Calls `updateScriptCounters()`

**SSOT at this phase**: `window.currentStoryOriginalSentences` (array) is authoritative snapshot; textarea is display.

---

### Textarea Input Handler + scriptSource Behavior

**File**: `public/creative.html:8834-8852` (IIFE, runs on page load)

**Exact behavior**:
- Line 8835: Gets `scriptPreviewEl = document.getElementById('article-script-preview')`
- Line 8837: Creates `debounceTimer = null`
- Line 8838: Adds `input` event listener
- Line 8840-8844: Debounces 300ms, then:
  - Calls `updateScriptCounters()`
  - Sets `window.scriptSource = 'manual'`
- Line 8848-8850: On page load, if textarea has content, calls `updateScriptCounters()`

**Critical**: Setting `textarea.value` programmatically may or may not fire `input` event (browser-dependent). **UNKNOWN** - needs verification.

**Risk #7**: If beat editor syncs textarea, this handler may fire and overwrite `scriptSource = 'llm'` → `'manual'`.

---

### updateScriptCounters() and Button Enable/Disable Logic

**File**: `public/creative.html:6319-6337` (`updateScriptCounters()`)

**Exact behavior**:
- Line 6320-6322: Gets textarea and counters element
- Line 6324: Reads `text = textarea.value`
- Line 6325-6327: Splits by `\n`, trims, filters empty: `beats = text.split('\n').map(s => s.trim()).filter(s => s.length > 0)`
- Line 6328: Gets `totalChars = text.length`
- Line 6330: Updates counter: `Beats: ${beats.length} / ${MAX_BEATS} | Total: ${totalChars} / ${MAX_TOTAL_CHARS}`
- Line 6333-6336: Gets prepare button, disables if `beats.length === 0`

**SSOT at this phase**: Textarea value is source of truth for counter calculation.

**Risk #9**: If beat editor has visual wrapping that creates `\n` in textarea, counter will be wrong.

---

### normalizeScript() and Where/When It Is Called

**File**: `public/creative.html:6224-6316` (`normalizeScript(originalText)`)

**Exact behavior**:
- Line 6229-6231: Splits by `\n`, trims, filters empty → `beats` array
- Line 6236-6283: For each beat > 160 chars:
  - Splits by sentence boundaries (`[.!?]+`)
  - If still too long, splits by commas
  - If still too long, splits by spaces
  - Pushes split parts to `splitBeats`
- Line 6292-6295: Truncates to `MAX_BEATS` (8) if exceeds
- Line 6299-6303: Enforces `MAX_TOTAL_CHARS` (850), truncates last beat if needed
- Returns: `{ normalizedBeats, trimmedChars, didSplitLongBeat, didTruncateBeats }`

**Called from**:
- `public/creative.html:6545` - `prepareStoryboard()` Priority 2 (manual script path)

**SSOT**: Normalization modifies textarea value (line 6548-6549), writes back normalized text.

**Risk #2**: Auto-splitting conflicts with per-beat editing in beat editor.

---

### prepareStoryboard() Priority Paths + Edit Detection

**File**: `public/creative.html:6434-6637` (`prepareStoryboard()`)

**Priority 1: LLM + Session Path** (Line 6466-6536):
- Line 6463: Reads `scriptText = scriptPreviewEl.value.trim()`
- Line 6466: Checks `if (scriptSource === 'llm' && sessionId)`
- Line 6468-6470: Splits textarea by `\n` to get `currentSentences` array
- Line 6477: Gets `originalSentences = window.currentStoryOriginalSentences || []`
- Line 6478-6479: Compares: `sentencesChanged = originalSentences.length !== currentSentences.length || originalSentences.some((s, i) => s !== currentSentences[i])`
- Line 6482-6490: If changed, calls `/api/story/update-script` with `sentences: currentSentences` (array)
- Line 6497: Updates stored original: `window.currentStoryOriginalSentences = [...currentSentences]`
- Line 6501-6514: Calls `/api/story/plan` → `/api/story/search`
- Line 6520: Gets `session = searchResp.data`
- Line 6523: Stores: `window.currentStorySession = session`
- Line 6526: Calls `renderStoryboard(session)`

**Priority 2: Manual Script Path** (Line 6539-6624):
- Line 6540: Checks `if (scriptText.length > 0)`
- Line 6542: Gets `originalText = scriptText`
- Line 6545: Calls `normalizeScript(originalText)`
- Line 6548-6549: Writes normalized back: `scriptPreviewEl.value = normalizedText`
- Line 6552: Calls `updateScriptCounters()`
- Line 6555-6562: Shows toast if normalization occurred
- Line 6570-6575: Calls `/api/story/manual` with `scriptText: normalizedText` (string)
- Line 6581: Gets `newSessionId = manualResp.data.sessionId`
- Line 6582: Sets `window.currentStorySessionId = newSessionId`
- Line 6583: Sets `window.scriptSource = 'llm'` (treats as LLM path)
- Line 6586: Stores original: `window.currentStoryOriginalSentences = [...normalizedBeats]`
- Line 6589-6606: Calls `/api/story/plan` → `/api/story/search`
- Line 6614: Calls `renderStoryboard(session)`

**SSOT transition**: Before `prepareStoryboard()`, textarea is SSOT. After, `session.story.sentences` is SSOT.

**Risk #3**: Edit detection compares textarea (string) to original array. If beat editor updates array directly, changes won't be detected.

**Risk #4**: `prepareStoryboard()` reads textarea. If beat editor doesn't sync textarea, storyboard uses stale data.

---

### Session Mode Beat Edits (commitBeatTextEdit)

**File**: `public/creative.html:7514-7620` (`commitBeatTextEdit()`)

**Exact behavior**:
- Line 7517: Gets `{ el, identifier, isDraft, originalText }` from `currentBeatEditing`
- Line 7518: Gets `newText = (el.textContent || "").trim()`
- Line 7528-7532: If no change, reverts and returns
- Line 7535-7566: Draft mode: Updates `window.draftStoryboard.beats` directly, no API call
- Line 7570-7607: Session mode:
  - Line 7573-7580: Calls `/api/story/update-beat-text` with `{ sessionId, sentenceIndex: identifier, text: newText }`
  - Line 7590: Gets `{ sentences, shots }` from response
  - Line 7596: Updates `window.currentStorySession.story.sentences = sentences`
  - Line 7597: Updates `window.currentStorySession.shots = shots`
  - Line 7606: Calls `renderStoryboard(window.currentStorySession)` to refresh DOM
  - Line 7607: Calls `updateRenderArticleButtonState()`

**SSOT**: After edit, `session.story.sentences` is updated, DOM refreshed. Textarea is NOT synced.

**Risk #8**: Textarea and beat editor show stale values after session mode beat edit.

---

### Caption Preview DOM Lookup Logic (beatId/sentenceIndex)

**File**: `public/js/caption-preview.js:751-842` (`generateBeatCaptionPreview(beatId, text, style)`)

**Exact behavior**:
- Line 751: Accepts `beatId` (string) as identifier
- Line 809: Calls `/api/caption/preview` with payload
- Line 820: Returns `{ beatId, meta, rasterUrl }`

**File**: `public/js/caption-preview.js:851-893` (`generateBeatCaptionPreviewDebounced()`)

**Exact behavior**:
- Line 857: Normalizes `id = String(beatId)`
- Line 876-877: DOM lookup: `document.querySelector(\`[data-beat-id="${id}"]\`) || document.querySelector(\`[data-sentence-index="${id}"]\`)`
- Line 883: Calls `applyPreviewResultToBeatCard(beatCardEl, result)`

**File**: `public/creative.html:6755, 6892` - DOM attributes:
- Session mode: `card.setAttribute('data-sentence-index', idx)` (line 6755)
- Draft mode: `card.setAttribute('data-beat-id', beat.id)` (line 6892)

**SSOT**: Caption preview uses `beatId` (string) or `sentenceIndex` (number) to find DOM card.

**Risk #6**: If identifier doesn't match DOM attribute, preview won't apply.

---

### Caption Generation + Render Matching

**File**: `src/services/story.service.js:695-737` (`generateCaptionTimings()`)

**Exact behavior**:
- Line 707: Iterates `for (let i = 0; i < session.story.sentences.length; i++)`
- Line 708: Finds shot: `session.plan.find(s => s.sentenceIndex === i) || session.plan[i]`
- Line 709: Gets sentence: `session.story.sentences[i]`
- Line 722: Creates caption: `{ sentenceIndex: i, text: sentence, startTimeSec, endTimeSec }`
- Line 731: Stores: `session.captions = captions`

**File**: `src/services/story.service.js:743-1042` (`renderStory()`)

**Exact behavior**:
- Line 766: Iterates `for (let i = 0; i < shotsWithClips.length; i++)`
- Line 768: Finds caption: `session.captions.find(c => c.sentenceIndex === shot.sentenceIndex)`
- Line 783: Uses `caption.text` for TTS generation

**SSOT**: Captions use `sentenceIndex` matching array index. Render matches by `sentenceIndex`.

**Risk #6**: If beats reordered after caption generation, `sentenceIndex` values don't match.

**Invariant**: `session.captions[j].sentenceIndex` must exist in `session.story.sentences` range.

---

### SSOT Summary by Phase

**Before storyboard creation**:
- SSOT: `#article-script-preview` textarea value (string)
- Backup: `window.currentStoryOriginalSentences` (array, for edit detection)
- Flag: `window.scriptSource` ('llm' or 'manual')

**After storyboard creation**:
- SSOT: `session.story.sentences` (array of strings)
- Display: Textarea becomes read-only (or should be)
- DOM: Storyboard cards use `data-sentence-index` matching array index

**Transition point**: `prepareStoryboard()` function creates session and switches SSOT.

---

## 2) TARGET UX SPEC

### Default View = Beats (Recommended)

**Primary UI**: Beat Editor with numbered beats (01, 02, 03...)

**Visual design**:
- Each beat displayed as a card or row with:
  - Beat number badge (01, 02, 03...)
  - Editable text field (single-line input or textarea with CSS wrapping)
  - Character count indicator (e.g., "45/160")
  - Future: Remix/Regenerate button (Phase 3)
- Beats displayed in vertical list
- "+ Add beat" button (disabled at 8 beats max)
- Total character counter at bottom

**Raw view toggle**:
- Toggle button: "Raw text view" / "Beat editor view"
- Raw view: Current textarea (editable, newlines create beats)
- Beat view: Beat Editor UI (default)

---

### Raw → Beats Conversion Rule

**Exact rule**:
1. Split textarea by `\n` boundaries
2. Trim each segment
3. Filter empty segments (`filter(s => s.length > 0)`)
4. Create beat objects: `[{ id: generateBeatId(), text: segment }]`

**Normalization**: MUST reuse `normalizeScript()` logic ONLY at explicit sync points:
- When user clicks "Prepare storyboard" (Priority 2 path)
- When user clicks "Apply" button in raw view (if we add one in Phase 2)
- NOT on every toggle or edit

**Validation**: Before commit to session:
- Each beat must be ≤ 160 chars (show error, don't auto-split in beat editor)
- Total beats must be ≤ 8 (disable "+ Add beat" at limit)
- Total chars must be ≤ 850 (show running total, prevent exceeding)

---

### Beats Editor Wrapping

**Visual wrapping**: Purely CSS (`word-wrap: break-word`, `white-space: pre-wrap` for display)

**Storage**: Beat text must be single-line strings (no internal `\n`)

**Display**: Beat can wrap to 2+ visual lines via CSS, but stored string has no `\n`

**Invariant**: No beat string contains `\n` before commit to `session.story.sentences`.

---

### Handling Paste with Internal Newlines

**Scenario**: User pastes text containing `\n` into a beat editor field.

**Rule**:
- Option A (recommended): Block paste, show error "Pasted text contains line breaks. Use Raw view to paste multi-line text."
- Option B: Normalize `\n` to space on paste
- Option C: Split into multiple beats (user confirmation required)

**Recommendation**: Option A - prevents accidental beat splitting, forces explicit action.

---

## 3) STATE MODEL + SYNC CONTRACT

### State Variables

```javascript
// SSOT before storyboard creation
window.currentBeats = [
  { id: string, text: string }  // id is stable, generated on creation
]

// Original snapshot (for edit detection)
window.currentStoryOriginalSentences = string[]  // Array of text strings (no IDs)

// SSOT after storyboard creation
window.currentStorySession = {
  story: { sentences: string[] },  // Array index === sentenceIndex
  shots: [{ sentenceIndex: number, ... }],
  captions: [{ sentenceIndex: number, ... }]
}

// View mode
window.currentViewMode = 'beats' | 'raw'  // Default: 'beats'

// Sync guard
window._syncingTextarea = false  // Prevents input handler from firing during programmatic sync
```

---

### Sync Functions

#### A) beatsFromTextarea(rawText, mode)

**Purpose**: Parse textarea string → beats array

**Parameters**:
- `rawText`: string (textarea value)
- `mode`: 'normalize' | 'parse-only'
  - 'normalize': Apply `normalizeScript()` logic (splits long beats, enforces limits)
  - 'parse-only': Just split by `\n`, trim, filter empty (no normalization)

**Returns**: `{ beats: [{ id, text }], didNormalize: boolean, warnings: string[] }`

**When called**:
- Raw → Beats toggle (mode: 'parse-only')
- "Apply" button in raw view (mode: 'normalize')
- "Prepare storyboard" click, if in raw view (mode: 'normalize')

**Implementation notes**:
- If mode='normalize', call `normalizeScript(rawText)`, then map `normalizedBeats` to `{ id: generateBeatId(), text }`
- If mode='parse-only', split by `\n`, trim, filter, map to `{ id: generateBeatId(), text }`
- Generate stable IDs for each beat

**Risk mitigation**:
- Risk #1: Parse-only mode doesn't split beats, preserves user intent
- Risk #2: Normalize mode only runs at explicit sync points, not on every edit

---

#### B) textareaFromBeats(beats)

**Purpose**: Convert beats array → textarea string

**Parameters**:
- `beats`: `[{ id, text }]` or `string[]`

**Returns**: string (newline-joined)

**When called**:
- Beats → Raw toggle
- Before `prepareStoryboard()` if in beats view (to sync textarea)
- After session beat edit (to sync textarea display)

**Implementation notes**:
- Extract text: `beats.map(b => typeof b === 'string' ? b : b.text).join('\n')`
- Set `window._syncingTextarea = true` before `textarea.value = ...`
- Set `window._syncingTextarea = false` after
- Does NOT call `updateScriptCounters()` (caller responsible)

**Risk mitigation**:
- Risk #7: `_syncingTextarea` flag prevents input handler from firing
- Risk #9: Counter calculation should use beats array, not textarea

---

#### C) setBeats(beats, options)

**Purpose**: Update `window.currentBeats` and sync UI

**Parameters**:
- `beats`: `[{ id, text }]` or `string[]`
- `options`: `{ source: 'user' | 'llm' | 'session' | 'sync', syncTextarea?: boolean, updateCounters?: boolean }`

**Returns**: void

**When called**:
- LLM generation: `setBeats(sentences, { source: 'llm', syncTextarea: true, updateCounters: true })`
- User edit in beat editor: `setBeats(updatedBeats, { source: 'user', syncTextarea: true, updateCounters: true })`
- Session beat edit: `setBeats(session.story.sentences, { source: 'session', syncTextarea: true, updateCounters: true })`
- Toggle Raw → Beats: `setBeats(parsedBeats, { source: 'sync', syncTextarea: false, updateCounters: true })`

**Implementation notes**:
- Normalize input: Convert `string[]` to `[{ id, text }]` if needed
- Update `window.currentBeats`
- If `syncTextarea`: Call `textareaFromBeats(beats)`
- If `updateCounters`: Call `updateScriptCounters()` (which should read from `currentBeats` if available)
- If `source === 'llm'`: Set `window.scriptSource = 'llm'` and store `window.currentStoryOriginalSentences = beats.map(b => b.text)`
- If `source === 'user'`: Don't change `scriptSource` (preserve 'llm' if set)

**Risk mitigation**:
- Risk #3: Stores `currentStoryOriginalSentences` for edit detection
- Risk #7: Doesn't overwrite `scriptSource` unless source='llm'
- Risk #8: Syncs textarea after session edits

---

#### D) syncFromSessionToUI(session)

**Purpose**: Ensure Beat Editor + textarea reflect `session.story.sentences`

**Parameters**:
- `session`: Story session object

**Returns**: void

**When called**:
- After `prepareStoryboard()` completes (session created)
- After session beat edit (`commitBeatTextEdit()`)
- After beat deletion/insertion (backend reindexes)
- On page load if session exists

**Implementation notes**:
- Extract: `sentences = session.story?.sentences || []`
- Map to beats: `beats = sentences.map((text, idx) => ({ id: `beat-${idx}`, text }))` (temporary IDs, will be replaced on next storyboard)
- Call: `setBeats(beats, { source: 'session', syncTextarea: true, updateCounters: true })`
- Update view: If beat editor active, refresh beat cards

**Risk mitigation**:
- Risk #4: Ensures UI reflects session SSOT after storyboard creation
- Risk #8: Syncs textarea and beat editor after session edits

---

#### E) beforePrepareStoryboardHook()

**Purpose**: Ensure `prepareStoryboard()` reads correct source

**Returns**: void

**When called**:
- First line of `prepareStoryboard()` function (before any reads)

**Implementation notes**:
- Check `window.currentViewMode`:
  - If 'beats' and `window.currentBeats` exists:
    - Call `textareaFromBeats(window.currentBeats)` to sync textarea
    - Ensure `window._syncingTextarea = true` during sync
  - If 'raw':
    - Textarea is already SSOT, no sync needed
- After sync, `prepareStoryboard()` continues with existing logic (reads textarea)

**Risk mitigation**:
- Risk #4: Guarantees textarea is synced from beats before `prepareStoryboard()` reads it
- Risk #3: Textarea sync ensures edit detection works (compares textarea to original)

---

### Sync Contract Summary

**Before storyboard**:
- `window.currentBeats` is SSOT (if beat editor active)
- Textarea is SSOT (if raw view active)
- Sync on toggle: `beatsFromTextarea()` or `textareaFromBeats()`
- Sync before `prepareStoryboard()`: `beforePrepareStoryboardHook()`

**After storyboard**:
- `session.story.sentences` is SSOT
- Sync on session update: `syncFromSessionToUI(session)`
- Textarea and beat editor are display-only

**Edit detection**:
- Compare `currentBeats.map(b => b.text)` to `currentStoryOriginalSentences`
- Or compare textarea (split by `\n`) to `currentStoryOriginalSentences`
- Must happen before `prepareStoryboard()` reads source

---

## 4) MINIMAL-DIFF IMPLEMENTATION PHASES

### Phase 1: Mirror Beat Editor (Safest)

**Goal**: Add Beat Editor UI that mirrors textarea, but textarea remains actual input.

**Changes**:

**File**: `public/creative.html`

1. **Add Beat Editor DOM structure** (after line 966, before "Prepare storyboard" button):
   ```html
   <!-- Beat Editor (initially hidden) -->
   <div id="beat-editor" class="space-y-2 hidden">
     <div id="beat-list" class="space-y-2"></div>
     <div class="flex justify-between items-center">
       <button id="add-beat-btn" class="text-xs px-2 py-1 bg-gray-600 hover:bg-gray-500 rounded">+ Add beat</button>
       <div id="beat-editor-counters" class="text-xs text-gray-500 dark:text-gray-400"></div>
     </div>
   </div>
   ```

2. **Add toggle button** (after line 956, before textarea):
   ```html
   <div class="flex justify-between items-center">
     <label class="block text-sm font-medium text-gray-700 dark:text-gray-300">Script Preview</label>
     <button id="toggle-view-btn" class="text-xs px-2 py-1 bg-gray-600 hover:bg-gray-500 rounded">Raw view</button>
   </div>
   ```

3. **Modify `updateScriptCounters()`** (line 6319-6337):
   - Add check: If `window.currentBeats` exists, count from array length
   - Fallback to textarea split if `currentBeats` doesn't exist
   - Update both `#script-preview-counters` and `#beat-editor-counters`

4. **Add `renderBeatEditor(beats)` function** (new function, after `updateScriptCounters()`):
   - Takes `beats = window.currentBeats || []`
   - Renders beat cards with number, text input, character count
   - Attaches input handlers that update `window.currentBeats` and sync textarea

5. **Add `syncTextareaFromBeats()` function** (new function):
   - Implements `textareaFromBeats()` logic
   - Sets `window._syncingTextarea = true` before setting `textarea.value`
   - Sets flag to `false` after

6. **Modify textarea input handler** (line 8834-8852):
   - Add guard: `if (window._syncingTextarea) return;`
   - After debounce, if `currentViewMode === 'beats'`, call `beatsFromTextarea(textarea.value, 'parse-only')` and update `currentBeats`

7. **Add toggle handler** (new function):
   - Toggles `window.currentViewMode` between 'beats' and 'raw'
   - Shows/hides beat editor and textarea
   - On Raw → Beats: Calls `beatsFromTextarea(textarea.value, 'parse-only')`, sets `currentBeats`, calls `renderBeatEditor()`
   - On Beats → Raw: Shows textarea (already synced)

8. **Modify `prepareStoryboard()`** (line 6434):
   - First line: Call `beforePrepareStoryboardHook()`
   - Rest of function unchanged (reads textarea as before)

9. **Modify `summarizeArticle()`** (line 6412-6413):
   - After setting `scriptPreviewEl.value`, call `setBeats(sentences, { source: 'llm', syncTextarea: false, updateCounters: true })`
   - If `currentViewMode === 'beats'`, call `renderBeatEditor()`

**Files touched**:
- `public/creative.html`: Lines 6319-6337, 6412-6413, 6434, 8834-8852, plus new functions and DOM

**Risk mitigation**:
- Risk #7: `_syncingTextarea` flag prevents input handler from firing
- Risk #9: Counter reads from `currentBeats` if available
- Risk #4: `beforePrepareStoryboardHook()` syncs textarea before `prepareStoryboard()` reads it

---

### Phase 2: Add Toggle with Explicit Apply

**Goal**: Make toggle explicit, add "Apply" button for normalization.

**Changes**:

**File**: `public/creative.html`

1. **Modify toggle button** (from Phase 1):
   - Change to: "Switch to Raw" / "Switch to Beats"
   - Add confirmation if unsaved changes detected

2. **Add "Apply" button in raw view** (after textarea, before counters):
   ```html
   <button id="apply-raw-btn" class="text-xs px-2 py-1 bg-blue-600 hover:bg-blue-500 rounded">Apply (normalize)</button>
   ```
   - On click: Calls `beatsFromTextarea(textarea.value, 'normalize')`
   - Shows toast if normalization occurred (reuse existing toast logic)
   - Updates `currentBeats`, switches to beat view

3. **Modify `beatsFromTextarea()`** (from Phase 1):
   - Implement 'normalize' mode: Calls `normalizeScript(rawText)`, maps to beats
   - Returns `{ beats, didNormalize, warnings }`

4. **Update edit detection** (line 6477-6479):
   - If `currentViewMode === 'beats'` and `currentBeats` exists:
     - Compare `currentBeats.map(b => b.text)` to `currentStoryOriginalSentences`
   - Else: Use existing textarea comparison

**Files touched**:
- `public/creative.html`: Toggle handler, new "Apply" button, `beatsFromTextarea()` implementation, edit detection logic

**Risk mitigation**:
- Risk #3: Edit detection compares beats array if in beat view
- Risk #2: Normalization only runs on explicit "Apply", not on every edit

---

### Phase 3: Per-Beat Remix/Regenerate (Stubs)

**Goal**: Add Remix/Regenerate buttons per beat (UI only, no backend yet).

**Changes**:

**File**: `public/creative.html`

1. **Modify beat card rendering** (in `renderBeatEditor()` from Phase 1):
   - Add "Remix" button next to each beat text input
   - Add "Regenerate" button next to each beat text input
   - Buttons disabled for now (stubs)

2. **Add click handlers** (stubs):
   - `handleRemixBeat(beatId)` - console.log for now
   - `handleRegenerateBeat(beatId)` - console.log for now

**Files touched**:
- `public/creative.html`: `renderBeatEditor()` function, new stub handlers

**No risk mitigation needed** (stubs only).

---

## 5) COPY + SEMANTICS CHANGES

### UI Copy Changes

**File**: `public/creative.html:956`

**Current**: 
```html
<p class="text-xs text-gray-500 dark:text-gray-400 leading-tight">Each line will become one clip.</p>
```

**Proposed**:
```html
<p class="text-xs text-gray-500 dark:text-gray-400 leading-tight">Each numbered beat becomes one clip. (Beats can wrap to multiple lines.)</p>
```

**Rationale**: Clarifies that beats are numbered units, not visual lines.

---

### Internal Variable Naming

**Keep existing "sentences" contract**:
- Backend APIs use `sentences[]` (don't change)
- `session.story.sentences` remains (don't change)
- Internal frontend can use "beats" terminology in UI, but map to "sentences" for API calls

**New variables**:
- `window.currentBeats` - Frontend-only, maps to `sentences[]` for API
- `window.currentViewMode` - Frontend-only state

**No breaking changes**: All API calls still use `sentences[]` array.

---

## 6) TEST PLAN

### Pre-Implementation Checklist

1. **Verify newline semantics**:
   - Open textarea, type "Beat 1", press Enter, type "Beat 2"
   - Verify counter shows "Beats: 2 / 8"
   - Call `prepareStoryboard()` → Verify 2 beats created
   - **Assert**: No beat string contains `\n` in `session.story.sentences`

2. **Verify normalization logic**:
   - Type beat with 200 chars in textarea
   - Click "Prepare storyboard"
   - Verify auto-split occurs (toast shown)
   - Verify split beats are in `session.story.sentences`

3. **Verify edit detection**:
   - LLM generates script
   - Edit textarea (change one beat)
   - Click "Prepare storyboard"
   - Verify `/api/story/update-script` is called with updated sentences

4. **Verify storyboard source**:
   - Create storyboard
   - Verify `session.story.sentences` matches textarea (split by `\n`)
   - Edit textarea after storyboard
   - Verify storyboard doesn't change (session is SSOT)

5. **Verify identifier mapping**:
   - Create draft beats with IDs
   - Click "Prepare storyboard"
   - Verify `sentenceIndex` matches array index (0, 1, 2...)
   - Verify DOM has `data-sentence-index` attributes

6. **Verify caption matching**:
   - Create storyboard, generate captions
   - Verify `session.captions[j].sentenceIndex` exists in `session.story.sentences` range
   - Render video → Verify correct captions on clips

7. **Verify textarea handler**:
   - LLM generates script → `scriptSource = 'llm'`
   - Type in textarea → Verify `scriptSource` changes to 'manual' after debounce
   - **UNKNOWN**: Does programmatic `textarea.value = ...` fire `input` event? (Test in browser console)

8. **Verify beat edit flow**:
   - Create storyboard
   - Edit beat text in storyboard card
   - Verify backend updates `session.story.sentences[sentenceIndex]`
   - Verify textarea shows updated text (may need to check)

9. **Verify counter calculation**:
   - Type 3 beats in textarea
   - Verify counter shows "Beats: 3 / 8"
   - Add newline → Verify counter shows "Beats: 4 / 8"

10. **Verify constants**:
    - Check `MAX_BEATS = 8`, `MAX_BEAT_CHARS = 160`, `MAX_TOTAL_CHARS = 850` in `src/services/story.service.js:29-31`

---

### Post-Implementation Smoke Tests

1. **LLM Generation → Beat Editor**:
   - Generate script from article
   - Verify beats appear in beat editor (numbered 01, 02, 03...)
   - Verify textarea shows joined text (if raw view visible)
   - Edit beat in editor → Verify textarea syncs (if raw view visible)
   - Click "Prepare storyboard" → Verify storyboard matches beats

2. **Raw View → Beat Editor Toggle**:
   - Paste multi-line text in raw view
   - Click "Switch to Beats" → Verify beats created (one per line)
   - Edit beat in editor → Click "Switch to Raw" → Verify textarea shows updated text
   - Click "Switch to Beats" → Verify beats match textarea

3. **Beat Edit in Session Mode**:
   - Create storyboard
   - Edit beat text in storyboard card
   - Verify backend updates `session.story.sentences[sentenceIndex]`
   - Verify textarea syncs from session (if raw view visible)
   - Verify beat editor syncs from session (if beat view active)

4. **Beat Deletion**:
   - Create storyboard with 3 beats
   - Delete beat at index 1 (via storyboard card delete button)
   - Verify backend reindexes: `sentenceIndex` 0, 1 (was 0, 1, 2)
   - Verify storyboard refreshes with correct `sentenceIndex`
   - Verify captions are cleared (status = 'shots_planned')

5. **Beat Insertion**:
   - Create storyboard with 2 beats
   - Insert beat after index 0 (via storyboard "+ Add beat" button)
   - Verify backend inserts at index 1, reindexes: `sentenceIndex` 0, 1, 2
   - Verify storyboard refreshes with correct order
   - Verify captions are cleared

6. **Normalization Limits**:
   - Type beat with 200 chars in beat editor
   - Verify validation error shown (no auto-split in beat editor)
   - Switch to raw view → Type 200 char beat
   - Click "Apply (normalize)" → Verify auto-split occurs (toast shown)

7. **Counter Accuracy**:
   - Create 3 beats in beat editor
   - Verify counter shows "Beats: 3 / 8"
   - Toggle to raw view → Verify counter still shows "Beats: 3 / 8"
   - Add newline in raw view → Verify counter shows "Beats: 4 / 8"

8. **Caption Preview**:
   - Create storyboard
   - Edit beat text → Verify caption preview updates (if feature enabled)
   - Verify preview uses correct `sentenceIndex` or `beatId`
   - Verify preview applies to correct DOM card

9. **Render Pipeline**:
   - Create storyboard with 3 beats
   - Generate captions
   - Delete beat at index 1
   - Verify captions are cleared
   - Re-generate captions → Verify `sentenceIndex` matches `session.story.sentences` indices
   - Render video → Verify correct captions on correct clips

10. **Edit Detection**:
    - LLM generates script
    - Edit beat in beat editor
    - Click "Prepare storyboard"
    - Verify edit detection compares beats array to original
    - Verify `/api/story/update-script` is called with updated sentences
    - Verify backend `session.story.sentences` is updated

11. **Failure-Mode Detector** (NEW):
    - Before any commit to `session.story.sentences`, assert:
      ```javascript
      session.story.sentences.forEach((s, i) => {
        if (s.includes('\n')) {
          throw new Error(`Beat ${i} contains internal newline: ${JSON.stringify(s)}`);
        }
      });
      ```
    - Add this assertion in:
      - `prepareStoryboard()` before calling `/api/story/update-script`
      - `prepareStoryboard()` before calling `/api/story/manual`
      - `commitBeatTextEdit()` before calling `/api/story/update-beat-text`

---

## 7) OPEN QUESTIONS / UNKNOWNS

### Unknown #1: Does programmatic `textarea.value = ...` fire `input` event?

**Question**: When we set `textarea.value` programmatically (in `textareaFromBeats()`), does it trigger the `input` event listener?

**Why it matters**: If yes, the input handler will fire and set `scriptSource = 'manual'`, breaking Risk #7 mitigation.

**How to verify**:
```javascript
// In browser console on creative.html page
const textarea = document.getElementById('article-script-preview');
let fired = false;
textarea.addEventListener('input', () => { fired = true; console.log('input fired'); });
textarea.value = 'test';
setTimeout(() => console.log('Fired?', fired), 100);
```

**Mitigation if yes**: Use `_syncingTextarea` flag guard (already planned).

**Mitigation if no**: No additional guard needed, but keep flag for safety.

---

### Unknown #2: Does `textarea.value` assignment trigger browser reflow/repaint immediately?

**Question**: When we set `textarea.value`, is the DOM updated synchronously, or could there be a timing issue?

**Why it matters**: If async, `_syncingTextarea` flag might be reset before input handler fires.

**How to verify**: Same test as Unknown #1, but check timing with `requestAnimationFrame`.

**Mitigation**: Set flag before assignment, reset in `setTimeout(..., 0)` or `requestAnimationFrame`.

---

### Unknown #3: What happens if user toggles view while `prepareStoryboard()` is running?

**Question**: Can user click toggle button while async `prepareStoryboard()` is in progress?

**Why it matters**: Could cause race condition where textarea is modified during storyboard creation.

**How to verify**: Manual test - click "Prepare storyboard", immediately click toggle, observe behavior.

**Mitigation**: Disable toggle button while `prepareStoryboard()` is loading (`setLoading('prepare-storyboard-btn', true)`).

---

### Unknown #4: Does `normalizeScript()` preserve beat order when splitting?

**Question**: When `normalizeScript()` splits a long beat into multiple beats, are they inserted at the same position, or appended?

**Why it matters**: Affects `sentenceIndex` alignment if beats are inserted rather than replaced.

**How to verify**: Read `normalizeScript()` implementation (line 6236-6283):
- Line 6234: Creates `splitBeats = []`
- Line 6235-6287: For each beat, if > 160 chars, splits and pushes parts to `splitBeats`
- Line 6285: Else, pushes original beat to `splitBeats`
- **Answer**: Split beats replace original beat at same position (order preserved)

**Mitigation**: None needed (order is preserved).

---

### Unknown #5: Can `session.story.sentences` be modified directly by other code paths?

**Question**: Are there other places besides `updateStorySentences()` and `updateBeatText()` that modify `session.story.sentences`?

**Why it matters**: Need to ensure `syncFromSessionToUI()` is called after all modifications.

**How to verify**: 
```bash
grep -r "story\.sentences\s*=" src/
grep -r "sentences\[" src/services/story.service.js
```

**Mitigation**: Audit all modification points, ensure `syncFromSessionToUI()` called after each`.

---

## 8) RISK MITIGATION SUMMARY

| Risk | Mitigation Strategy |
|------|---------------------|
| #1: Newline semantics | Beat editor blocks Enter, normalizes `\n` to space on paste |
| #2: Normalization conflicts | Normalization only runs on explicit "Apply", not on every edit |
| #3: Edit detection breaks | Compare `currentBeats.map(b => b.text)` to original if in beat view |
| #4: Storyboard uses stale data | `beforePrepareStoryboardHook()` syncs textarea from beats before read |
| #5: Identifier mapping lost | Maintain `beatIdToSentenceIndex` mapping, refresh DOM after reindex |
| #6: Caption matching breaks | Clear captions on beat count/order change, force re-generate |
| #7: scriptSource flipped | `_syncingTextarea` flag prevents input handler from firing |
| #8: Textarea not synced | `syncFromSessionToUI()` called after all session edits |
| #9: Counter wrong | Counter reads from `currentBeats.length` if available, fallback to textarea |

---

**END OF IMPLEMENTATION PLAN**






