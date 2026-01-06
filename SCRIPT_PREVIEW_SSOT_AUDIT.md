# Script Preview SSOT Audit Report

**Date**: 2025-01-XX  
**Purpose**: Read-only audit of Script Preview pipeline to identify touchpoints before Beat Editor migration  
**Status**: NO CODE CHANGES - Audit Only

---

## A) Current Semantics & Source of Truth

### What is a "beat" today?
- **Definition**: One line in the script preview textarea, separated by newline (`\n`)
- **Location**: `public/creative.html:6229-6231` - `normalizeScript()` splits by `\n`, trims, filters empty
- **Server-side**: `src/services/story.service.js:1049-1051` - `createManualStorySession()` uses same logic
- **Invariant**: `beats.length === session.story.sentences.length` after storyboard preparation

### What is a "line" today?
- **Definition**: Identical to "beat" - one newline-delimited segment
- **UI Copy**: `public/creative.html:956` - "Each line will become one clip."
- **Counter Display**: `public/creative.html:964` - "Beats: 0 / 8 | Total: 0 / 850"
- **Note**: Terminology is mixed - UI says "line" but code/counters say "beat"

### Where is the authoritative representation stored?
- **Before storyboard preparation**: `#article-script-preview` textarea value (string)
- **After storyboard preparation**: `session.story.sentences` (array of strings)
- **Transition point**: `prepareStoryboard()` function (`public/creative.html:6434-6637`)
- **Critical**: Once session exists, `session.story.sentences` is SSOT; textarea becomes display-only

### Constants & Limits
- **MAX_BEATS**: 8 (`src/services/story.service.js:29`)
- **MAX_BEAT_CHARS**: 160 per beat (`src/services/story.service.js:30`)
- **MAX_TOTAL_CHARS**: 850 total (`src/services/story.service.js:31`)

---

## B) Pipeline Touchpoints (Must-Not-Break List)

### 1. Script Generation → Preview

**File**: `public/creative.html:6340-6432` (`summarizeArticle()`)

**Flow**:
1. User pastes URL/text → calls `/api/story/generate`
2. Backend returns `{ story: { sentences: string[] } }`
3. Frontend joins array with `\n`: `sentences.join('\n')`
4. Writes to textarea: `scriptPreviewEl.value = scriptText`
5. Stores original: `window.currentStoryOriginalSentences = [...sentences]`
6. Sets flag: `window.scriptSource = 'llm'`

**Key Lines**:
- `public/creative.html:6411-6413` - Array → newline-joined string
- `public/creative.html:6416` - Stores original array for edit detection

**Assumptions**:
- Backend always returns `sentences` as array
- Array order is stable (becomes sentenceIndex later)
- Each array element becomes one beat

**Risk if broken**: LLM-generated scripts won't display correctly

---

### 2. Preview → Storyboard Build

**File**: `public/creative.html:6434-6637` (`prepareStoryboard()`)

**Priority 1: LLM + Session Path** (`public/creative.html:6466-6536`):
1. Reads textarea: `scriptText.split('\n').map(s => s.trim()).filter(s => s.length > 0)`
2. Compares to `window.currentStoryOriginalSentences` to detect edits
3. If edited, calls `/api/story/update-script` with array
4. Calls `/api/story/plan` → `/api/story/search`
5. Receives session with `session.story.sentences` and `session.shots[]`
6. Calls `renderStoryboard(session)`

**Priority 2: Manual Script Path** (`public/creative.html:6539-6624`):
1. Reads textarea: `scriptText = scriptPreviewEl.value.trim()`
2. Normalizes: `normalizeScript(originalText)` → splits by `\n`, validates, may split long beats
3. Writes back: `scriptPreviewEl.value = normalizedBeats.join('\n')`
4. Calls `/api/story/manual` with `scriptText` (newline-joined string)
5. Backend splits: `scriptText.split('\n')` → `session.story.sentences = beats`
6. Calls `/api/story/plan` → `/api/story/search`
7. Calls `renderStoryboard(session)`

**Key Functions**:
- `normalizeScript()` (`public/creative.html:6224-6316`):
  - Splits by `\n`, trims, filters empty
  - Splits beats > 160 chars (by sentence boundaries, then comma, then space)
  - Truncates to 8 beats max
  - Enforces 850 char total limit
- `updateScriptCounters()` (`public/creative.html:6319-6337`):
  - Reads textarea, splits by `\n` to count beats
  - Updates UI: `Beats: ${beats.length} / ${MAX_BEATS}`

**Assumptions**:
- Textarea value is authoritative before storyboard creation
- Newlines are beat boundaries (no multi-line beats)
- Normalization may modify text (user sees toast)
- After storyboard, `session.story.sentences` is SSOT

**Risk if broken**: Storyboard won't match user's script, or beats will be misaligned

---

### 3. Storyboard Build → Clip Selection

**File**: `public/creative.html:6729-6829` (`renderStoryboard()`)

**Flow**:
1. Reads `session.story.sentences` (array)
2. Reads `session.shots[]` (array with `sentenceIndex` property)
3. Iterates: `sentences.forEach((sentence, idx) => { ... })`
4. Finds shot: `shots.find(s => s.sentenceIndex === idx) || shots[idx]`
5. Creates DOM card with `data-sentence-index="${idx}"`
6. Renders sentence text, clip preview, swap/delete buttons

**Key Lines**:
- `public/creative.html:6741` - `const sentences = session.story?.sentences || []`
- `public/creative.html:6749` - `sentences.forEach((sentence, idx) => {`
- `public/creative.html:6751` - `const shot = shots.find(s => s.sentenceIndex === idx)`
- `public/creative.html:6755` - `card.setAttribute('data-sentence-index', idx)`

**Assumptions**:
- `session.story.sentences` array order matches `sentenceIndex` (0-based)
- `session.shots[i].sentenceIndex === i` (invariant maintained in backend)
- DOM `data-sentence-index` attribute is used for edit/delete/swap operations

**Risk if broken**: Storyboard cards won't match sentences, or operations will target wrong beat

---

### 4. Clip Selection → Caption Preview

**File**: `public/creative.html:7750-8139` (`openClipPicker()`)

**Draft Mode** (no session):
- Uses `beatId` (string): `window.clipPickerBeatId = beatIdOrIndex`
- `public/creative.html:7758-7765`

**Session Mode**:
- Uses `sentenceIndex` (number): `window.currentClipPickerSentence = beatIdOrIndex`
- Finds shot: `session.shots.find(s => s.sentenceIndex === beatIdOrIndex)`
- `public/creative.html:7767-7786`

**Caption Preview**:
- `public/js/caption-preview.js:751-842` (`generateBeatCaptionPreview()`)
- Accepts `beatId` (string) or uses `sentenceIndex` from DOM
- Calls `/api/caption/preview` with beat text
- Applies preview to card: `document.querySelector(\`[data-beat-id="${id}"]\`) || document.querySelector(\`[data-sentence-index="${id}"]\`)`

**Assumptions**:
- `sentenceIndex` is stable (doesn't change when beats are reordered)
- Caption preview is per-beat (one preview per sentenceIndex)

**Risk if broken**: Caption previews won't update correctly, or will show on wrong beat

---

### 5. Caption Generation → Render

**File**: `src/services/story.service.js:695-737` (`generateCaptionTimings()`)

**Flow**:
1. Iterates: `for (let i = 0; i < session.story.sentences.length; i++)`
2. Gets sentence: `session.story.sentences[i]`
3. Finds shot: `session.plan.find(s => s.sentenceIndex === i) || session.plan[i]`
4. Calculates duration from text
5. Creates caption: `{ sentenceIndex: i, text: sentence, startTimeSec, endTimeSec }`
6. Stores: `session.captions[]` array

**Key Lines**:
- `src/services/story.service.js:707` - Loop uses array index `i`
- `src/services/story.service.js:708` - Finds shot by `sentenceIndex === i`
- `src/services/story.service.js:722` - Caption stores `sentenceIndex: i`

**Assumptions**:
- `session.story.sentences` array index === `sentenceIndex`
- `session.plan[]` and `session.shots[]` have matching `sentenceIndex` values
- Caption order matches sentence order

**Risk if broken**: Captions will be misaligned with clips during render

---

### 6. Render Pipeline

**File**: `src/services/story.service.js:743-1042` (`renderStory()`)

**Flow**:
1. Filters shots: `session.shots.filter(s => s.selectedClip?.url)`
2. Iterates: `for (let i = 0; i < shotsWithClips.length; i++)`
3. Gets shot: `shotsWithClips[i]`
4. Finds caption: `session.captions.find(c => c.sentenceIndex === shot.sentenceIndex)`
5. Generates TTS for `caption.text`
6. Renders video segment with caption overlay

**Key Lines**:
- `src/services/story.service.js:768` - `session.captions.find(c => c.sentenceIndex === shot.sentenceIndex)`
- `src/services/story.service.js:783` - TTS uses `caption.text`
- `src/services/story.service.js:845` - ASS file built from `caption.text` and timestamps

**Assumptions**:
- `shot.sentenceIndex` matches `caption.sentenceIndex`
- Caption text is the exact sentence from `session.story.sentences[sentenceIndex]`
- Render order follows `shotsWithClips` array order (which may skip unselected clips)

**Risk if broken**: Wrong captions on wrong clips, or missing captions

---

## C) UI Copy / Label Audit

### Places "line" wording appears:

1. **Script Preview Label** (`public/creative.html:956`):
   - Text: `"Each line will become one clip."`
   - Context: Help text below "Script Preview" label
   - Should change to: `"Each beat will become one clip."` or `"Each line (beat) will become one clip."`

2. **Counter Display** (`public/creative.html:964`):
   - Text: `"Beats: 0 / 8 | Total: 0 / 850"`
   - Status: ✅ Already uses "Beats" terminology
   - No change needed

3. **Code Comments**:
   - `public/creative.html:6410` - `"// Display sentences in script preview (one per line)"`
   - Should update to clarify: `"// Display sentences in script preview (one per line = one beat)"`

### User-facing confusion risks:

- **Mixed terminology**: UI says "line" but counters say "beat"
- **Edit behavior**: Users may not realize newlines create new beats
- **Normalization feedback**: Toast message mentions "beats" but UI label says "line"

---

## D) Greenlight Criteria for Beat Editor Migration

### ✅ Must Maintain:

1. **Stable beat ordering**
   - `session.story.sentences` array order must remain stable
   - `sentenceIndex` must not change unless beats are explicitly reordered
   - Backend reindexing logic (`src/services/story.service.js:523-526`) must be preserved

2. **Preserve sentenceIndex alignment**
   - `session.story.sentences[i]` must match `session.shots[j].sentenceIndex === i`
   - `session.captions[k].sentenceIndex === i` must match sentence at index `i`
   - DOM `data-sentence-index` attributes must match array indices

3. **Keep ability to paste raw text**
   - Must support pasting multi-line text that auto-splits into beats
   - Normalization logic (`normalizeScript()`) must still work
   - Manual textarea input path must remain functional

4. **Ensure storyboard builds from beats array, not visual wrapping**
   - Storyboard must use `session.story.sentences` array, not textarea value
   - Visual line wrapping in editor must not create new beats
   - Only explicit beat boundaries (newlines or beat separators) create beats

5. **Ensure counters match beats array length**
   - `updateScriptCounters()` must count from beats array, not textarea
   - Counter must reflect actual beat count, not visual line count

### ⚠️ Critical Invariants:

- **Invariant 1**: `session.shots[i].sentenceIndex === i` (maintained by backend reindexing)
- **Invariant 2**: `session.captions[j].sentenceIndex` must exist in `session.story.sentences` range
- **Invariant 3**: `session.plan[k].sentenceIndex` must match `session.story.sentences` indices
- **Invariant 4**: DOM `data-sentence-index` must match array index (not beatId)

---

## E) Minimal Implementation Plan (No Code)

### Recommended Approach:

1. **Introduce `window.currentBeats = []` as SSOT**
   - Structure: `[{ id: string, text: string }]`
   - Populated from:
     - LLM response: map `sentences[]` to beats with generated IDs
     - Textarea paste: parse newlines → create beats with IDs
     - Manual edits: update beat text in array
   - Sync to textarea: `textarea.value = currentBeats.map(b => b.text).join('\n')` (display only)

2. **Keep raw textarea as alternate view**
   - Add toggle: "Raw text view" / "Beat editor view"
   - Raw view: editable textarea (current behavior)
   - Beat view: list of beat cards with per-beat editing
   - Sync on toggle: parse textarea → beats array, or beats array → textarea

3. **Parse raw-to-beats on explicit "Apply" or on toggle**
   - When user toggles to beat editor: parse textarea → `currentBeats`
   - When user clicks "Apply" in raw view: parse → `currentBeats`, then switch to beat view
   - When user edits in beat editor: update `currentBeats` directly, sync textarea for display

4. **Storyboard creation uses beats array**
   - `prepareStoryboard()` reads `window.currentBeats` (not textarea)
   - Maps beats to `session.story.sentences` array
   - Maintains `sentenceIndex` as array index (0-based)
   - Backend receives array, not newline-joined string

5. **Beat ID → sentenceIndex mapping**
   - Before storyboard: beats have stable IDs (`beat.id`)
   - After storyboard: beats map to `sentenceIndex` (array index)
   - Store mapping: `window.beatIdToSentenceIndex = { [beatId]: sentenceIndex }`
   - Use for draft mode operations (edit, delete, swap clip)

### Warning List - Risky Areas:

1. **`normalizeScript()` function** (`public/creative.html:6224-6316`)
   - Currently splits long beats by sentence boundaries
   - If beat editor allows per-beat editing, normalization may conflict
   - **Risk**: User edits beat → normalization splits it → user confusion
   - **Mitigation**: Disable auto-splitting in beat editor mode, show validation errors instead

2. **Edit detection logic** (`public/creative.html:6477-6498`)
   - Compares textarea value to `window.currentStoryOriginalSentences`
   - If beat editor updates `currentBeats` directly, edit detection breaks
   - **Risk**: Changes won't be detected, won't call `/api/story/update-script`
   - **Mitigation**: Compare `currentBeats.map(b => b.text)` to original array

3. **Counter calculation** (`public/creative.html:6319-6337`)
   - Currently reads textarea and splits by `\n`
   - If beat editor has visual wrapping, counter will be wrong
   - **Risk**: Counter shows incorrect beat count
   - **Mitigation**: Count from `currentBeats.length` instead

4. **Draft mode vs Session mode** (`public/creative.html:7020-8139`)
   - Draft mode uses `beatId` (string)
   - Session mode uses `sentenceIndex` (number)
   - If beat editor introduces IDs before session, mapping must be maintained
   - **Risk**: Operations target wrong beat if ID/index mapping is lost
   - **Mitigation**: Maintain `beatIdToSentenceIndex` mapping throughout lifecycle

5. **Backend newline parsing** (`src/services/story.service.js:1049-1051`)
   - `createManualStorySession()` splits by `\n`
   - If beat editor sends array, backend must accept both formats
   - **Risk**: Backend breaks if format changes
   - **Mitigation**: Backend accepts `beats[]` array OR `scriptText` string (backward compatible)

6. **Caption preview identifier** (`public/js/caption-preview.js:751-842`)
   - Uses `beatId` (string) or `sentenceIndex` (number)
   - Must handle both draft (beatId) and session (sentenceIndex) modes
   - **Risk**: Preview won't apply if identifier doesn't match DOM
   - **Mitigation**: DOM must have both `data-beat-id` and `data-sentence-index` attributes

---

## F) Additional Findings

### Edge Cases:

1. **Empty lines in textarea**:
   - Current: Filtered out (`filter(s => s.length > 0)`)
   - Behavior: Multiple consecutive newlines create no beats
   - **Migration note**: Beat editor should prevent empty beats, or auto-remove them

2. **Manual textarea editing**:
   - Current: User can edit textarea, add/remove newlines
   - Behavior: Newlines create new beats on next `prepareStoryboard()` call
   - **Migration note**: Beat editor should sync textarea on every beat edit, or disable textarea editing

3. **Beat deletion**:
   - Current: `deleteBeat()` (`src/services/story.service.js:561-595`) reindexes all shots
   - Behavior: `sentenceIndex` values shift down after deletion
   - **Migration note**: Beat editor deletion must trigger reindexing, or use stable IDs

4. **Beat insertion**:
   - Current: `insertBeat()` (`src/services/story.service.js:488-540`) inserts at index, reindexes
   - Behavior: All `sentenceIndex` values after insertion point shift up
   - **Migration note**: Beat editor insertion must maintain array order, reindex backend

### Formatting & Normalization:

1. **Long beat splitting**:
   - Current: `normalizeScript()` splits beats > 160 chars
   - Splits by: sentence boundaries → commas → spaces
   - **Migration note**: Beat editor should validate length, prevent splitting, show error

2. **Total character limit**:
   - Current: 850 chars total, truncates last beat if needed
   - **Migration note**: Beat editor should show running total, prevent exceeding limit

3. **Beat count limit**:
   - Current: 8 beats max, truncates excess
   - **Migration note**: Beat editor should prevent adding beats beyond limit

---

## G) File Reference Summary

### Critical Files (Must Not Break):

1. **`public/creative.html`**:
   - `summarizeArticle()` (6340-6432) - Script generation
   - `prepareStoryboard()` (6434-6637) - Storyboard creation
   - `normalizeScript()` (6224-6316) - Beat normalization
   - `updateScriptCounters()` (6319-6337) - Counter updates
   - `renderStoryboard()` (6729-6829) - Storyboard rendering
   - `openClipPicker()` (7750-8139) - Clip selection
   - `handleSwapButtonClick()` (7020-7457) - Beat operations

2. **`src/services/story.service.js`**:
   - `generateStory()` (111-142) - Story generation
   - `updateStorySentences()` (147-170) - Script updates
   - `planShots()` (175-188) - Shot planning
   - `createManualStorySession()` (1047-1086) - Manual session creation
   - `generateCaptionTimings()` (695-737) - Caption generation
   - `renderStory()` (743-1042) - Video rendering
   - `deleteBeat()` (561-595) - Beat deletion
   - `insertBeat()` (488-540) - Beat insertion
   - `updateBeatText()` (601-636) - Beat text updates

3. **`src/services/story.llm.service.js`**:
   - `generateStoryFromInput()` (146-540) - LLM script generation
   - Returns: `{ sentences: string[], totalDurationSec: number }`

4. **`public/js/caption-preview.js`**:
   - `generateBeatCaptionPreview()` (751-842) - Per-beat caption preview
   - Uses `beatId` or `sentenceIndex` to identify beat

5. **`src/routes/story.routes.js`**:
   - `/api/story/generate` (77-105) - Script generation endpoint
   - `/api/story/update-script` (107-125) - Script update endpoint
   - `/api/story/manual` (528-559) - Manual session creation endpoint

---

## H) Migration Safety Checklist

Before implementing Beat Editor:

- [ ] Verify `session.story.sentences` array is always SSOT after storyboard creation
- [ ] Ensure `sentenceIndex` alignment is maintained (array index === sentenceIndex)
- [ ] Test that textarea parsing (newline split) produces same beats as array
- [ ] Confirm backend accepts both array and newline-joined string formats
- [ ] Validate that beat deletion/insertion reindexing logic works correctly
- [ ] Check that caption preview works with both `beatId` and `sentenceIndex`
- [ ] Ensure counter calculation uses beats array, not textarea
- [ ] Test edit detection with beats array instead of textarea comparison
- [ ] Verify normalization logic doesn't conflict with per-beat editing
- [ ] Confirm DOM `data-sentence-index` attributes match array indices
- [ ] Test draft mode (beatId) → session mode (sentenceIndex) transition
- [ ] Validate that render pipeline finds correct captions by sentenceIndex

---

**END OF AUDIT REPORT**





