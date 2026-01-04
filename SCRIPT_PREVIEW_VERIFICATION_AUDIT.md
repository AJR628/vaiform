# Script Preview Verification Audit - Risky Areas

**Date**: 2025-01-XX  
**Purpose**: Verification audit of 6 risky areas + additional risks before Beat Editor implementation  
**Status**: READ-ONLY - No Code Changes

---

## STEP 0: Summary of 6 Risky Areas (from SCRIPT_PREVIEW_SSOT_AUDIT.md)

1. **`normalizeScript()` function** - Auto-splits long beats, may conflict with per-beat editing
2. **Edit detection logic** - Compares textarea value to original array, breaks if beat editor updates array directly
3. **Counter calculation** - Reads textarea and splits by `\n`, wrong if beat editor has visual wrapping
4. **Draft mode vs Session mode** - Uses `beatId` (string) vs `sentenceIndex` (number), mapping must be maintained
5. **Backend newline parsing** - `createManualStorySession()` splits by `\n`, must accept both array and string formats
6. **Caption preview identifier** - Uses `beatId` or `sentenceIndex`, DOM must have both attributes

---

## Risk Verification Table

### Risk #1: Newline Semantics & Internal Line Breaks

**What breaks:**
- If user types Enter inside textarea, it creates a new beat immediately (via `input` event → `updateScriptCounters()`)
- If beat editor allows multi-line text with internal `\n`, those will be split into separate beats when parsing
- Storyboard creation will see more beats than intended, shifting all `sentenceIndex` values

**Where (file:function:line range):**
- `public/creative.html:8834-8852` - Textarea `input` event listener (debounced 300ms)
- `public/creative.html:6319-6337` - `updateScriptCounters()` splits by `\n` to count beats
- `public/creative.html:6229-6231` - `normalizeScript()` splits by `\n`, trims, filters empty
- `public/creative.html:6468-6470` - `prepareStoryboard()` Priority 1 path splits textarea by `\n`
- `public/creative.html:6412` - `summarizeArticle()` joins `sentences[]` with `\n` to populate textarea
- `src/services/story.service.js:1049-1051` - `createManualStorySession()` splits `scriptText` by `\n`

**Repro steps:**
1. Open script preview textarea
2. Type "Beat 1" then press Enter (creates newline)
3. Type "Beat 2"
4. Observe: Counter shows "Beats: 2 / 8"
5. Call `prepareStoryboard()` → Creates 2 beats, `sentenceIndex` 0 and 1
6. **If beat editor allows internal newlines**: User types "Beat 1\nwith newline" → Parsed as 2 beats

**Required invariant:**
- No internal `\n` inside a beat string once committed to `session.story.sentences`
- Each beat must be a single-line string (no newline characters)
- Textarea newlines = beat boundaries (1:1 mapping)

**Mitigation (no code):**
- Beat Editor: Block Enter key, normalize `\n` to space on paste/input
- Raw view: Keep current behavior (Enter creates new beat)
- Toggle sync: When switching Raw → Beat Editor, split by `\n` and create beat array
- When switching Beat Editor → Raw, join with `\n` and populate textarea
- Validation: Reject beats containing `\n` before commit to session

---

### Risk #2: Normalization & Limits Consistency

**What breaks:**
- `normalizeScript()` auto-splits beats > 160 chars, which conflicts with per-beat editing
- If beat editor validates length but normalization still runs, user's edits get split unexpectedly
- Empty lines are filtered out, but if beat editor allows empty beats, they'll be removed on sync
- Total char limit (850) truncates last beat, which may delete user's work silently

**Where (file:function:line range):**
- `public/creative.html:6224-6316` - `normalizeScript()` function (full implementation)
  - Line 6229: Splits by `\n`, trims, filters empty
  - Line 6236-6283: Splits long beats (>160 chars) by sentence boundaries → commas → spaces
  - Line 6292-6295: Truncates to MAX_BEATS (8)
  - Line 6299-6303: Enforces MAX_TOTAL_CHARS (850), truncates last beat
- `public/creative.html:6545` - Called in `prepareStoryboard()` Priority 2 (manual script path)
- `src/services/story.service.js:29-31` - Constants: `MAX_BEATS = 8`, `MAX_BEAT_CHARS = 160`, `MAX_TOTAL_CHARS = 850`
- `src/services/story.service.js:1054-1067` - Server-side validation in `createManualStorySession()` (no auto-split, throws error)

**Repro steps:**
1. User types beat with 200 chars in beat editor
2. User clicks "Prepare storyboard"
3. `normalizeScript()` splits it into 2 beats automatically
4. User sees toast: "Auto-formatted: to fit the max length"
5. **Problem**: User's single beat became 2 beats, shifting all subsequent `sentenceIndex` values

**Required invariant:**
- Any Raw↔Beats parsing must reuse `normalizeScript()` logic, not create duplicate parser
- Beat Editor must enforce limits BEFORE normalization runs (show validation errors)
- Normalization should only run on explicit "Apply" or "Prepare storyboard", not on every edit

**Mitigation (no code):**
- Beat Editor mode: Disable auto-splitting, show validation errors for beats > 160 chars
- Prevent adding beats beyond 8 limit (disable "+ Add beat" button)
- Show running total char count, prevent exceeding 850
- Raw view: Keep normalization behavior (auto-split on "Prepare storyboard")
- Sync point: Only normalize when switching Raw → Beat Editor or on "Prepare storyboard"
- Backend: Keep server-side validation (throws error, doesn't auto-split)

---

### Risk #3: Edited-State Detection / Save Flow

**What breaks:**
- Edit detection compares textarea value (string) to `window.currentStoryOriginalSentences` (array)
- If beat editor updates `window.currentBeats` directly, textarea comparison won't detect changes
- `/api/story/update-script` won't be called, backend session won't update
- Storyboard creation will use stale sentences from backend

**Where (file:function:line range):**
- `public/creative.html:6477-6498` - Edit detection in `prepareStoryboard()` Priority 1 path
  - Line 6468-6470: Splits textarea by `\n` to get `currentSentences` array
  - Line 6477: Gets `originalSentences` from `window.currentStoryOriginalSentences`
  - Line 6478-6479: Compares length and content
  - Line 6484-6490: Calls `/api/story/update-script` if changed
- `public/creative.html:6416` - Stores original after LLM generation: `window.currentStoryOriginalSentences = [...sentences]`
- `public/creative.html:6497` - Updates stored original after successful update
- `public/creative.html:6586` - Stores original after manual session creation
- `src/services/story.service.js:147-170` - `updateStorySentences()` accepts `sentences[]` array
- `src/routes/story.routes.js:107-125` - `/api/story/update-script` endpoint expects `sentences[]` array

**Repro steps:**
1. LLM generates script → `window.currentStoryOriginalSentences = ['Beat 1', 'Beat 2']`
2. User edits in beat editor → `window.currentBeats = [{id: 'x', text: 'Beat 1 edited'}, {id: 'y', text: 'Beat 2'}]`
3. Textarea still shows original (not synced)
4. User clicks "Prepare storyboard"
5. Edit detection compares textarea (unchanged) to original → No change detected
6. `/api/story/update-script` not called
7. Backend still has original sentences
8. Storyboard created with stale data

**Required invariant:**
- Beat Editor updates must flow into `/api/story/update-script` payload and preserve ordering
- Edit detection must compare beats array to original array, not textarea to original
- Textarea must be synced from beats array before edit detection runs

**Mitigation (no code):**
- Beat Editor: On any beat edit, update `window.currentBeats` AND sync textarea
- Edit detection: Compare `currentBeats.map(b => b.text)` to `window.currentStoryOriginalSentences`
- Before `prepareStoryboard()`: Sync textarea from `currentBeats` if in beat editor mode
- Store original as array: `window.currentStoryOriginalSentences = currentBeats.map(b => b.text)`
- Ensure `/api/story/update-script` receives array in correct order (matching `sentenceIndex` alignment)

---

### Risk #4: Storyboard Build Uses Which Source?

**What breaks:**
- `prepareStoryboard()` Priority 1 reads textarea and splits by `\n` (line 6468)
- `prepareStoryboard()` Priority 2 reads textarea and normalizes (line 6545)
- If beat editor doesn't sync textarea, storyboard will use stale textarea value
- After storyboard creation, `renderStoryboard()` uses `session.story.sentences` (array) as SSOT
- If user edits textarea after storyboard, those edits won't be reflected until `prepareStoryboard()` is called again

**Where (file:function:line range):**
- `public/creative.html:6434-6637` - `prepareStoryboard()` function
  - Line 6463: Reads `scriptText = scriptPreviewEl.value.trim()`
  - Line 6468-6470: Priority 1 splits textarea by `\n`
  - Line 6540: Priority 2 reads `scriptText` from textarea
  - Line 6545: Calls `normalizeScript(originalText)` on textarea value
- `public/creative.html:6729-6829` - `renderStoryboard(session)` function
  - Line 6741: Uses `session.story?.sentences || []` (array, not textarea)
  - Line 6749: Iterates `sentences.forEach((sentence, idx) => {`
  - Line 6751: Finds shot by `sentenceIndex === idx`
- `public/creative.html:7606` - After beat edit, calls `renderStoryboard(window.currentStorySession)` to refresh

**Repro steps:**
1. User edits in beat editor → `window.currentBeats = [{text: 'New beat'}]`
2. Textarea not synced (still shows old value)
3. User clicks "Prepare storyboard"
4. `prepareStoryboard()` reads textarea (old value) → Creates storyboard with old beats
5. `session.story.sentences` = old beats (from textarea)
6. `renderStoryboard()` shows old beats
7. User's beat editor changes are lost

**Required invariant:**
- Storyboard generation must take beats array as input (not visual wrapping)
- `session.story.sentences` must equal Beat Editor beats at commit time
- Textarea is display-only after storyboard creation (SSOT is `session.story.sentences`)

**Mitigation (no code):**
- Before `prepareStoryboard()`: If in beat editor mode, sync textarea from `currentBeats`
- `prepareStoryboard()`: Read from `currentBeats` if available, fallback to textarea
- After storyboard: `session.story.sentences` is SSOT, sync beat editor from session
- Disable textarea editing after storyboard creation (or make it read-only)
- On beat edit in session mode: Update `session.story.sentences[sentenceIndex]`, then re-render storyboard

---

### Risk #5: sentenceIndex / beatId Mapping & DOM Selectors

**What breaks:**
- Draft mode uses `beatId` (string), session mode uses `sentenceIndex` (number)
- DOM cards have `data-sentence-index` or `data-beat-id` attributes
- Click handlers (swap clip, edit, delete) use different identifiers
- If beat editor introduces IDs before session, mapping must be maintained
- If beats are reordered, `sentenceIndex` values shift, breaking DOM selectors

**Where (file:function:line range):**
- `public/creative.html:6755` - Storyboard card: `card.setAttribute('data-sentence-index', idx)`
- `public/creative.html:6762, 6770, 6777, 6790, 6807, 6814` - All buttons use `data-sentence-index="${idx}"`
- `public/creative.html:6892` - Draft mode card: `card.setAttribute('data-beat-id', beat.id)`
- `public/creative.html:6900, 6906, 6915, 6923, 6937, 6949, 6955` - Draft buttons use `data-beat-id="${beat.id}"`
- `public/creative.html:7022-7046` - `handleSwapButtonClick()` branches on `isDraft` flag
  - Line 7030: Draft uses `beatId = swapBtn.dataset.beatId`
  - Line 7038: Session uses `sentenceIndex = Number(swapBtn.dataset.sentenceIndex)`
- `public/creative.html:7460-7488` - `handleEditBeatInline()` branches on draft vs session
  - Line 7473: Draft uses `beatId = textEl.dataset.beatId`
  - Line 7483: Session uses `sentenceIndex = Number(textEl.dataset.sentenceIndex)`
- `public/creative.html:7750-7786` - `openClipPicker()` branches on draft vs session
- `public/js/caption-preview.js:751-842` - `generateBeatCaptionPreview()` accepts `beatId` (string)
- `public/js/caption-preview.js:876-877` - DOM lookup: `document.querySelector(\`[data-beat-id="${id}"]\`) || document.querySelector(\`[data-sentence-index="${id}"]\`)`
- `src/services/story.service.js:561-595` - `deleteBeat()` reindexes all shots after deletion
- `src/services/story.service.js:488-540` - `insertBeatWithSearch()` reindexes all shots after insertion

**Repro steps:**
1. User creates 3 beats in draft mode: `[{id: 'a', text: 'Beat 1'}, {id: 'b', text: 'Beat 2'}, {id: 'c', text: 'Beat 3'}]`
2. User clicks "Prepare storyboard" → Creates session
3. Session has `sentences = ['Beat 1', 'Beat 2', 'Beat 3']` with `sentenceIndex` 0, 1, 2
4. User deletes beat at index 1
5. Backend reindexes: `sentences = ['Beat 1', 'Beat 3']`, `sentenceIndex` becomes 0, 1 (was 0, 2)
6. DOM still has `data-sentence-index="2"` for old beat 3
7. Click handlers target wrong beat

**Required invariant:**
- Beat Editor must not change indices unexpectedly
- If beats are added/removed, must intentionally reindex and refresh mappings
- DOM `data-sentence-index` must match `session.story.sentences` array index
- Draft `beatId` must map to `sentenceIndex` after storyboard creation

**Mitigation (no code):**
- Maintain `window.beatIdToSentenceIndex = { [beatId]: sentenceIndex }` mapping
- On storyboard creation: Map draft `beatId` → `sentenceIndex` (array index)
- On beat deletion: Call backend `deleteBeat()`, then re-render storyboard (DOM refreshed)
- On beat insertion: Call backend `insertBeat()`, then re-render storyboard
- DOM refresh: Always call `renderStoryboard(session)` after any beat add/delete/edit
- Click handlers: Use `sentenceIndex` from DOM attribute, validate it exists in `session.story.sentences`

---

### Risk #6: Caption Generation & Render Matching

**What breaks:**
- Captions are generated with `sentenceIndex` matching array index
- Render matches captions to shots by `sentenceIndex`
- If beats are reordered after caption generation, `sentenceIndex` values don't match
- Captions are cached and may become stale if beats change
- Render pipeline iterates `shotsWithClips` and finds caption by `sentenceIndex`, which may be wrong if reordered

**Where (file:function:line range):**
- `src/services/story.service.js:695-737` - `generateCaptionTimings()` function
  - Line 707: Iterates `for (let i = 0; i < session.story.sentences.length; i++)`
  - Line 708: Finds shot: `session.plan.find(s => s.sentenceIndex === i)`
  - Line 722: Creates caption: `{ sentenceIndex: i, text: sentence, ... }`
- `src/services/story.service.js:743-1042` - `renderStory()` function
  - Line 766: Iterates `for (let i = 0; i < shotsWithClips.length; i++)`
  - Line 768: Finds caption: `session.captions.find(c => c.sentenceIndex === shot.sentenceIndex)`
  - Line 783: Uses `caption.text` for TTS generation
- `public/js/caption-preview.js:751-842` - `generateBeatCaptionPreview()` caches by `(style, text)`
  - Line 762: Checks cache: `getCachedBeatPreview(style, text)`
  - Line 826: Caches result: `setCachedBeatPreview(style, text, result)`
- `src/services/story.service.js:162` - `updateStorySentences()` clears plan and shots: `if (session.plan) delete session.plan; if (session.shots) delete session.shots;`
- `src/services/story.service.js:163` - Sets status to `'story_generated'` (forces re-plan)

**Repro steps:**
1. User creates storyboard with 3 beats → Captions generated: `[{sentenceIndex: 0, text: 'Beat 1'}, {sentenceIndex: 1, text: 'Beat 2'}, {sentenceIndex: 2, text: 'Beat 3'}]`
2. User deletes beat at index 1
3. Backend reindexes: `sentences = ['Beat 1', 'Beat 3']`, `sentenceIndex` becomes 0, 1
4. Captions still have: `[{sentenceIndex: 0, text: 'Beat 1'}, {sentenceIndex: 1, text: 'Beat 2'}, {sentenceIndex: 2, text: 'Beat 3'}]`
5. Render finds caption for `sentenceIndex: 1` → Gets "Beat 2" (wrong, should be "Beat 3")
6. Video renders with wrong captions

**Required invariant:**
- Any edit that changes beat count/order must invalidate/rebuild captions (or force user to re-run storyboard step)
- `session.captions[j].sentenceIndex` must exist in `session.story.sentences` range
- Caption `sentenceIndex` must match `session.story.sentences` array index

**Mitigation (no code):**
- On beat deletion: Clear `session.captions`, set status to `'shots_planned'` (forces re-generate captions)
- On beat insertion: Clear `session.captions`, set status to `'shots_planned'`
- On beat reorder: Clear `session.captions`, set status to `'shots_planned'`
- On beat text edit: Keep captions (only text changed, `sentenceIndex` unchanged)
- Before render: Validate all `session.captions[j].sentenceIndex` exist in `session.story.sentences` range
- Caption preview cache: Key by `(style, text)`, not by `beatId` or `sentenceIndex` (already correct)

---

### Risk #7: Textarea Input Handler & Debounce Behavior

**What breaks:**
- Textarea has `input` event listener that debounces 300ms and sets `window.scriptSource = 'manual'`
- If beat editor updates `currentBeats` but textarea is not synced, input handler won't fire
- If textarea is synced from beats array, input handler fires and overwrites `scriptSource` flag
- Debounce timer may conflict with beat editor's own debounce logic

**Where (file:function:line range):**
- `public/creative.html:8834-8852` - Textarea input handler (IIFE)
  - Line 8838: `addEventListener('input', () => {`
  - Line 8840-8844: Debounces 300ms, calls `updateScriptCounters()`, sets `window.scriptSource = 'manual'`
- `public/creative.html:6462` - `prepareStoryboard()` reads `window.scriptSource` to determine path
- `public/creative.html:6419` - `summarizeArticle()` sets `window.scriptSource = 'llm'`
- `public/creative.html:6583` - Manual session creation sets `window.scriptSource = 'llm'` (treats as LLM path)

**Repro steps:**
1. LLM generates script → `window.scriptSource = 'llm'`
2. User edits in beat editor → `window.currentBeats` updated, textarea synced
3. Textarea `input` event fires → Debounce timer set
4. After 300ms: `updateScriptCounters()` called, `window.scriptSource = 'manual'` (overwrites 'llm')
5. User clicks "Prepare storyboard"
6. `prepareStoryboard()` reads `scriptSource = 'manual'` → Takes Priority 2 path (manual script)
7. Should have taken Priority 1 path (LLM + session)

**Required invariant:**
- `window.scriptSource` must accurately reflect script origin ('llm' vs 'manual')
- Textarea sync from beats array must not trigger input handler (or handler must detect programmatic change)
- Beat editor updates must not overwrite `scriptSource` flag incorrectly

**Mitigation (no code):**
- Textarea sync: Set `textarea.value` directly (doesn't fire `input` event in most browsers)
- If sync does fire event: Add flag `window._syncingTextarea = true`, check in handler, skip if true
- Beat editor mode: Disable textarea input handler (remove listener or add guard)
- `scriptSource` flag: Only set to 'manual' on actual user typing in textarea, not on programmatic updates
- Before `prepareStoryboard()`: If `currentBeats` exists, use that to determine source (not textarea)

---

### Risk #8: Beat Text Edit in Session Mode

**What breaks:**
- `commitBeatTextEdit()` in session mode calls `/api/story/update-beat-text` with `sentenceIndex`
- Backend `updateBeatText()` updates `session.story.sentences[sentenceIndex]` and `shot.searchQuery`
- Frontend then calls `renderStoryboard(window.currentStorySession)` to refresh DOM
- If textarea is not synced, it shows stale value
- If beat editor is not synced, it shows stale value

**Where (file:function:line range):**
- `public/creative.html:7514-7620` - `commitBeatTextEdit()` function
  - Line 7573-7580: Session mode calls `/api/story/update-beat-text`
  - Line 7590: Gets `{ sentences, shots }` from response
  - Line 7596: Updates `window.currentStorySession.story.sentences = sentences`
  - Line 7606: Calls `renderStoryboard(window.currentStorySession)` to refresh
- `src/services/story.service.js:601-636` - `updateBeatText()` backend function
  - Line 616: Updates `sentences[sentenceIndex] = text`
  - Line 621: Updates `shot.searchQuery = text` (keeps in sync)
- `public/creative.html:8834-8852` - Textarea input handler (may fire on sync)

**Repro steps:**
1. User edits beat text in storyboard card (session mode)
2. `commitBeatTextEdit()` called → Updates backend, refreshes storyboard
3. Textarea still shows old value (not synced)
4. User switches to raw view → Sees old text
5. User edits textarea → Overwrites beat edit

**Required invariant:**
- After beat text edit, textarea must be synced from `session.story.sentences`
- After beat text edit, beat editor must be synced from `session.story.sentences`
- Textarea and beat editor must always reflect `session.story.sentences` after any edit

**Mitigation (no code):**
- After `commitBeatTextEdit()`: Sync textarea from `window.currentStorySession.story.sentences`
- After `commitBeatTextEdit()`: Sync `window.currentBeats` from `session.story.sentences` (if beat editor active)
- Sync method: Join sentences with `\n` for textarea, map to beat objects for beat editor
- Sync must not trigger input handler (use flag or direct assignment)

---

### Risk #9: Counter Calculation & Button State

**What breaks:**
- `updateScriptCounters()` reads textarea and splits by `\n` to count beats
- If beat editor has visual wrapping (multi-line display), textarea may have extra newlines
- Counter shows wrong beat count
- "Prepare storyboard" button state depends on beat count (disabled if 0)

**Where (file:function:line range):**
- `public/creative.html:6319-6337` - `updateScriptCounters()` function
  - Line 6324: Reads `textarea.value`
  - Line 6325-6327: Splits by `\n`, trims, filters empty to count beats
  - Line 6330: Updates counter: `Beats: ${beats.length} / ${MAX_BEATS}`
  - Line 6335: Disables button if `beats.length === 0`
- `public/creative.html:8834-8852` - Textarea input handler calls `updateScriptCounters()` on debounce

**Repro steps:**
1. Beat editor displays beat with visual wrapping (CSS word-wrap)
2. User toggles to raw view → Textarea shows beat with internal newlines (from wrapping)
3. `updateScriptCounters()` splits by `\n` → Counts 2 beats (should be 1)
4. Counter shows "Beats: 2 / 8" (wrong)
5. User clicks "Prepare storyboard" → Creates 2 beats (wrong)

**Required invariant:**
- Counter must count from beats array, not textarea (if beat editor active)
- Counter must match actual beat count in `currentBeats` or `session.story.sentences`
- Visual wrapping in beat editor must not create newlines in textarea

**Mitigation (no code):**
- `updateScriptCounters()`: If `window.currentBeats` exists, count from array length
- If `window.currentStorySession` exists, count from `session.story.sentences.length`
- Fallback to textarea split only if neither exists
- Beat editor: Display with CSS wrapping, but store as single-line strings (no `\n`)
- Textarea sync: Join beats with `\n`, but each beat string has no internal `\n`

---

## MUST NOT CHANGE Behaviors

1. **Newline = Beat Boundary**: Textarea newlines must always create new beats (1:1 mapping)
2. **Normalization on Prepare**: `normalizeScript()` must run on "Prepare storyboard" for manual scripts
3. **Edit Detection**: Must compare arrays (not textarea) to detect changes before storyboard creation
4. **Session SSOT**: After storyboard creation, `session.story.sentences` is SSOT (not textarea)
5. **sentenceIndex Alignment**: `session.story.sentences[i]` must match `session.shots[j].sentenceIndex === i`
6. **Reindexing on Delete/Insert**: Backend must reindex all shots after beat deletion/insertion
7. **Caption Invalidation**: Beat count/order changes must clear captions (force re-generate)
8. **Draft vs Session Mode**: Draft uses `beatId` (string), session uses `sentenceIndex` (number)
9. **Backend Validation**: Server must validate beats (length, count, total chars) and throw errors (no auto-split)
10. **Render Matching**: Render finds captions by `sentenceIndex`, must match shot `sentenceIndex`

---

## Pre-Implementation Checklist

- [ ] **Verify newline semantics**: Confirm textarea Enter creates beat, no internal `\n` in beats
- [ ] **Verify normalization logic**: Test `normalizeScript()` with various inputs, confirm split behavior
- [ ] **Verify edit detection**: Test textarea vs array comparison, confirm `/api/story/update-script` is called
- [ ] **Verify storyboard source**: Confirm `prepareStoryboard()` reads textarea, `renderStoryboard()` uses session array
- [ ] **Verify identifier mapping**: Test draft `beatId` → session `sentenceIndex` transition, confirm DOM attributes
- [ ] **Verify caption matching**: Test caption generation with `sentenceIndex`, confirm render finds correct captions
- [ ] **Verify textarea handler**: Test debounce behavior, confirm `scriptSource` flag is set correctly
- [ ] **Verify beat edit flow**: Test session mode beat edit, confirm textarea syncs after update
- [ ] **Verify counter calculation**: Test with various beat counts, confirm button state updates
- [ ] **Verify constants**: Confirm `MAX_BEATS = 8`, `MAX_BEAT_CHARS = 160`, `MAX_TOTAL_CHARS = 850` are consistent

---

## Post-Implementation Smoke Tests

1. **LLM Generation → Beat Editor**:
   - Generate script from article
   - Verify beats appear in beat editor (one per line)
   - Verify textarea shows joined text
   - Edit beat in editor → Verify textarea syncs
   - Click "Prepare storyboard" → Verify storyboard matches beats

2. **Raw View → Beat Editor Toggle**:
   - Paste multi-line text in raw view
   - Toggle to beat editor → Verify beats created (one per line)
   - Edit beat in editor → Toggle back to raw → Verify textarea shows updated text
   - Toggle to editor → Verify beats match textarea

3. **Beat Edit in Session Mode**:
   - Create storyboard
   - Edit beat text in storyboard card
   - Verify backend updates `session.story.sentences[sentenceIndex]`
   - Verify textarea syncs from session
   - Verify beat editor syncs from session (if active)

4. **Beat Deletion**:
   - Create storyboard with 3 beats
   - Delete beat at index 1
   - Verify backend reindexes: `sentenceIndex` 0, 1 (was 0, 1, 2)
   - Verify storyboard refreshes with correct `sentenceIndex`
   - Verify captions are cleared (status = 'shots_planned')

5. **Beat Insertion**:
   - Create storyboard with 2 beats
   - Insert beat after index 0
   - Verify backend inserts at index 1, reindexes: `sentenceIndex` 0, 1, 2
   - Verify storyboard refreshes with correct order
   - Verify captions are cleared

6. **Normalization Limits**:
   - Type beat with 200 chars in beat editor
   - Verify validation error shown (no auto-split)
   - Switch to raw view → Type 200 char beat
   - Click "Prepare storyboard" → Verify auto-split occurs (toast shown)

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

---

**END OF VERIFICATION AUDIT**




