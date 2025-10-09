# Drag Handle Fix Summary

## Problem Analysis

The preview text box's drag handle had the following issues:
1. **Not always visible**: The drag handle only appeared in specific states
2. **Not functional**: When visible, the drag feature didn't work properly
3. **Confusing behavior**: Visibility seemed threshold-based but wasn't clearly defined

## Root Cause

The V2 overlay system had conflicting CSS rules:
- Legacy rule: `.caption-box:not(.editing) .drag-handle{ display:none; }` (line 128)
- V2 rule: `.caption-box.always-handle .drag-handle{ display:block !important; opacity:0.5; }` (line 138)
- V2 override: `.caption-box.always-handle:not(.editing) .drag-handle{ opacity:0; pointer-events:none; }` (line 140)

The issue: The box started with `isEditing = false`, which meant:
- V2 override (line 140) applied: `opacity:0` and `pointer-events:none`
- Drag handle was invisible and non-interactive by default
- User had to click the box first to enter editing mode before the handle would appear and work

## Solution

**File**: `public/js/caption-overlay.js`

### Change 1: Default to Editing Mode in V2 (Lines 284-303)

```javascript
// BEFORE:
let isEditing = false;

// AFTER:
let isEditing = overlayV2 ? true : false;

// Set initial editing state for V2
if (overlayV2) {
  setEditing(true);
}
```

**Rationale**: 
- V2 mode now starts with the box in editing state
- Drag handle is immediately visible and functional (opacity:1, pointer-events:auto)
- Maintains SSOT: server doesn't need to know about editing state

### Change 2: CSS Enhancement (Line 131)

```css
/* Added color:#fff to ensure handle text is always visible */
.caption-box .drag-handle{ 
  position:absolute; top:0; left:0; cursor:move; user-select:none; 
  padding:6px 10px; background:rgba(0,0,0,.25);
  border-top-left-radius:12px; border-top-right-radius:12px; 
  font: 12px/1 system-ui; letter-spacing:.08em; text-transform:uppercase; 
  color:#fff;  /* ← Added for visibility */
}
```

### CSS Cascade (How It Works Now)

1. **Base rule** (line 138): 
   - `.caption-box.always-handle .drag-handle{ display:block !important; opacity:0.6; pointer-events:auto; }`
   - Forces `display:block` to override legacy `display:none`
   - Default visible state with reduced opacity

2. **Editing state** (line 139):
   - `.caption-box.always-handle.editing .drag-handle{ opacity:1; }`
   - Full opacity when actively editing

3. **Clean preview** (line 140):
   - `.caption-box.always-handle:not(.editing) .drag-handle{ opacity:0; pointer-events:none; }`
   - Hidden and non-interactive when user clicks outside

## User Interaction Flow

### Normal State (Default)
1. Box starts in **editing mode** (`editing` class applied)
2. Drag handle visible (opacity:1)
3. Handle is fully functional—user can click and drag
4. Toolbar visible (if overlayV2)

### Clean Preview (After Clicking Outside)
1. User clicks anywhere outside the caption box
2. Event handler (line 306) detects click outside
3. Calls `setEditing(false)` → removes `editing` class
4. CSS line 140 applies: `opacity:0; pointer-events:none`
5. Drag handle becomes invisible (clean preview)
6. Toolbar hides

### Return to Editing
1. User clicks on the caption box
2. Event handler (line 313) detects click on box
3. Calls `setEditing(true)` → adds `editing` class back
4. CSS line 139 applies: `opacity:1`
5. Drag handle becomes visible and functional again
6. Toolbar reappears

## Drag Implementation (Unchanged)

The drag functionality was already correctly wired (lines 184-217):

1. **Pointer down** on handle (line 185):
   - Captures pointer position and box position
   - Sets `dragging = true`
   - Captures pointer to the handle element

2. **Pointer move** (line 197-205):
   - Calculates delta movement
   - Updates box position as percentages
   - Clamps to stage boundaries

3. **Pointer up** (line 215-216):
   - Clears drag state
   - Releases pointer capture

## Key Features Preserved

✅ **SSOT Compliance**: Client doesn't create new position calculations; uses percentages  
✅ **Clean Preview**: Clicking outside hides all controls (handle + toolbar)  
✅ **Editing Mode**: Clicking box shows all controls  
✅ **Immediate Access**: Drag handle available on page load (V2 mode)  
✅ **Smooth UX**: No threshold-based visibility; clear on/off states  
✅ **Legacy Compat**: Non-V2 mode unchanged  

## Testing Checklist

- [ ] Load creative.html with a quote and video
- [ ] Verify drag handle is visible in top-left of caption box (with "✥ drag" text)
- [ ] Click and hold drag handle, move mouse → caption box should follow cursor
- [ ] Release → box stays in new position
- [ ] Click outside caption box → handle should disappear (clean preview)
- [ ] Click back on caption box → handle should reappear
- [ ] Resize window → drag handle should remain functional
- [ ] Edit text content → drag handle should remain visible and functional

## Notes

- **No threshold logic**: There is no size-based threshold controlling drag handle visibility. Visibility is purely state-based (editing vs not editing).
- **V2 only**: Changes only affect V2 overlay mode (default). Legacy mode behavior unchanged.
- **Toolbar coordination**: Toolbar visibility is synchronized with drag handle via `setEditing()` function.
- **Pointer capture**: Uses modern Pointer Events API for smooth, reliable dragging across devices.

## Files Modified

1. `public/js/caption-overlay.js` (2 changes)
   - Lines 131: Added `color:#fff` to drag-handle CSS
   - Lines 284-303: Default editing state to `true` for V2 mode

## Related Code (No Changes Required)

- `public/creative.html`: Initializes overlay system, calls `initCaptionOverlay()`
- `public/js/caption-preview.js`: Server-side caption rendering (SSOT for measurements)
- `src/routes/caption.preview.routes.js`: Backend caption preview endpoint

## Future Enhancements (Optional)

1. Add keyboard shortcut (e.g., `Esc`) to toggle clean preview mode
2. Add persistent "lock" state to prevent accidental drags
3. Add snap-to-grid option for precise positioning
4. Add undo/redo for position changes

