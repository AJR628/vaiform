# Beat Preview CSS Positioning Diagnostic

## Issue Identified

Tests 1-6 all pass:
- ✅ Overlay element exists in DOM
- ✅ Overlay has `display: block`
- ✅ Overlay has dimensions (`offsetWidth > 0 && offsetHeight > 0`)
- ✅ CSS variables are set correctly

**But**: Caption is not visible on beat card → **CSS positioning issue**

---

## Test 10: CSS Positioning Check

Run this to check computed positioning:

```javascript
const overlay = document.querySelector('.beat-caption-overlay');
if (overlay) {
  const computed = window.getComputedStyle(overlay);
  const rect = overlay.getBoundingClientRect();
  
  console.log('=== CSS POSITIONING DIAGNOSTIC ===');
  console.log('\n[CSS Variables]');
  console.log('  --y-pct:', overlay.style.getPropertyValue('--y-pct'));
  console.log('  --raster-w-ratio:', overlay.style.getPropertyValue('--raster-w-ratio'));
  console.log('  --raster-h-ratio:', overlay.style.getPropertyValue('--raster-h-ratio'));
  
  console.log('\n[Computed Styles]');
  console.log('  position:', computed.position);
  console.log('  display:', computed.display);
  console.log('  top:', computed.top);
  console.log('  left:', computed.left);
  console.log('  width:', computed.width);
  console.log('  height:', computed.height);
  console.log('  z-index:', computed.zIndex);
  console.log('  transform:', computed.transform);
  console.log('  opacity:', computed.opacity);
  console.log('  visibility:', computed.visibility);
  
  console.log('\n[Bounding Rect]');
  console.log('  top:', rect.top);
  console.log('  left:', rect.left);
  console.log('  width:', rect.width);
  console.log('  height:', rect.height);
  console.log('  bottom:', rect.bottom);
  console.log('  right:', rect.right);
  
  console.log('\n[Container Check]');
  const container = overlay.parentElement;
  console.log('  parent:', container);
  console.log('  parent classes:', container?.className);
  const containerRect = container?.getBoundingClientRect();
  console.log('  container rect:', containerRect);
  console.log('  overlay in container bounds:', containerRect ? 
    (rect.top >= containerRect.top && 
     rect.left >= containerRect.left && 
     rect.bottom <= containerRect.bottom && 
     rect.right <= containerRect.right) : 'N/A');
  
  console.log('\n[Viewport Check]');
  console.log('  overlay in viewport:', 
    rect.top >= 0 && rect.left >= 0 && 
    rect.bottom <= window.innerHeight && 
    rect.right <= window.innerWidth);
}
```

**What to look for**:
- `top` should be a percentage-based calc (e.g., `calc(0.333333 * 100%)`)
- `width` and `height` should be percentage-based calcs
- `z-index` should be `10` or higher
- `transform` should include `translateX(-50%) translateY(-50%)`
- Overlay should be within container bounds

---

## Test 11: Container Structure Check

Run this to verify overlay is in correct container:

```javascript
const beatCard = document.querySelector('[data-beat-id]') || document.querySelector('[data-sentence-index]');
const overlay = beatCard?.querySelector('.beat-caption-overlay');

console.log('=== CONTAINER STRUCTURE ===');
console.log('\n[Beat Card]');
console.log('  element:', beatCard);
console.log('  classes:', beatCard?.className);
console.log('  overflow:', window.getComputedStyle(beatCard).overflow);

console.log('\n[Video Container]');
const videoContainer = beatCard?.querySelector('.relative.w-full.h-40');
console.log('  element:', videoContainer);
console.log('  classes:', videoContainer?.className);
console.log('  overflow:', videoContainer ? window.getComputedStyle(videoContainer).overflow : 'N/A');
console.log('  position:', videoContainer ? window.getComputedStyle(videoContainer).position : 'N/A');
console.log('  dimensions:', videoContainer ? {
  width: videoContainer.offsetWidth,
  height: videoContainer.offsetHeight
} : 'N/A');

console.log('\n[Overlay Location]');
console.log('  overlay parent:', overlay?.parentElement);
console.log('  overlay parent classes:', overlay?.parentElement?.className);
console.log('  overlay in video container:', videoContainer?.contains(overlay));
console.log('  overlay in beat card:', beatCard?.contains(overlay));
```

**What to look for**:
- Overlay should be inside `.relative.w-full.h-40` container
- Container should have `position: relative`
- Beat card should NOT have `overflow: hidden` (or overlay might be clipped)

---

## Test 12: Visual Position Check

Run this to see where overlay actually appears:

```javascript
const overlay = document.querySelector('.beat-caption-overlay');
if (overlay) {
  // Temporarily add visible border to see overlay position
  overlay.style.border = '3px solid red';
  overlay.style.backgroundColor = 'rgba(255, 0, 0, 0.3)';
  
  console.log('=== VISUAL POSITION CHECK ===');
  console.log('Red border and semi-transparent red background added to overlay');
  console.log('Look for red box on page - this shows where overlay is positioned');
  console.log('If you see red box but no caption image, image loading issue');
  console.log('If you see nothing, overlay is off-screen or hidden');
  
  setTimeout(() => {
    overlay.style.border = '';
    overlay.style.backgroundColor = '';
    console.log('Visual markers removed');
  }, 5000);
}
```

---

## Test 13: Image Loading Check

Run this to verify image actually loads:

```javascript
const overlay = document.querySelector('.beat-caption-overlay');
if (overlay) {
  console.log('=== IMAGE LOADING CHECK ===');
  console.log('  src:', overlay.src?.substring(0, 100) + '...');
  console.log('  complete:', overlay.complete);
  console.log('  naturalWidth:', overlay.naturalWidth);
  console.log('  naturalHeight:', overlay.naturalHeight);
  
  overlay.onload = () => {
    console.log('  ✅ Image loaded successfully');
    console.log('  naturalWidth:', overlay.naturalWidth);
    console.log('  naturalHeight:', overlay.naturalHeight);
  };
  
  overlay.onerror = () => {
    console.error('  ❌ Image failed to load');
  };
  
  // Force reload
  const src = overlay.src;
  overlay.src = '';
  overlay.src = src;
}
```

---

## Common CSS Issues

### Issue A: Overlay positioned off-screen
**Symptoms**: 
- `top` or `left` values are negative or very large
- `getBoundingClientRect()` shows overlay outside viewport

**Cause**: CSS calc() computing incorrectly or container not positioned

**Fix**: Check container has `position: relative`

### Issue B: Overlay behind other elements
**Symptoms**:
- Overlay exists but not visible
- `z-index` is too low

**Fix**: Increase z-index or check parent z-index stacking

### Issue C: Container clipping overlay
**Symptoms**:
- Overlay exists but cut off
- Container has `overflow: hidden`

**Fix**: Remove `overflow: hidden` from container or adjust positioning

### Issue D: Transform not applied
**Symptoms**:
- Overlay positioned but not centered
- `transform` is `none`

**Fix**: Verify CSS rule `.beat-caption-overlay { transform: translateX(-50%) translateY(-50%); }`

### Issue E: Image not loading
**Symptoms**:
- Overlay element exists but no image
- `naturalWidth` and `naturalHeight` are 0

**Fix**: Check data URL is valid, check network errors

---

## Quick All-in-One CSS Diagnostic

Run this to check everything at once:

```javascript
(function() {
  const overlay = document.querySelector('.beat-caption-overlay');
  if (!overlay) {
    console.error('No overlay found');
    return;
  }
  
  const computed = window.getComputedStyle(overlay);
  const rect = overlay.getBoundingClientRect();
  const container = overlay.parentElement;
  const containerRect = container?.getBoundingClientRect();
  
  console.log('=== COMPLETE CSS DIAGNOSTIC ===');
  
  // CSS Variables
  const yPct = overlay.style.getPropertyValue('--y-pct');
  const wRatio = overlay.style.getPropertyValue('--raster-w-ratio');
  const hRatio = overlay.style.getPropertyValue('--raster-h-ratio');
  
  console.log('\n[1] CSS Variables');
  console.log('  --y-pct:', yPct || '❌ MISSING');
  console.log('  --raster-w-ratio:', wRatio || '❌ MISSING');
  console.log('  --raster-h-ratio:', hRatio || '❌ MISSING');
  
  // Computed positioning
  console.log('\n[2] Computed Positioning');
  console.log('  position:', computed.position, computed.position === 'absolute' ? '✅' : '❌');
  console.log('  top:', computed.top);
  console.log('  left:', computed.left);
  console.log('  width:', computed.width);
  console.log('  height:', computed.height);
  console.log('  transform:', computed.transform, computed.transform !== 'none' ? '✅' : '❌');
  console.log('  z-index:', computed.zIndex);
  
  // Visibility
  console.log('\n[3] Visibility');
  console.log('  display:', computed.display, computed.display === 'block' ? '✅' : '❌');
  console.log('  opacity:', computed.opacity, computed.opacity !== '0' ? '✅' : '❌');
  console.log('  visibility:', computed.visibility, computed.visibility !== 'hidden' ? '✅' : '❌');
  
  // Bounding rect
  console.log('\n[4] Bounding Rect');
  console.log('  top:', rect.top, 'px');
  console.log('  left:', rect.left, 'px');
  console.log('  width:', rect.width, 'px', rect.width > 0 ? '✅' : '❌');
  console.log('  height:', rect.height, 'px', rect.height > 0 ? '✅' : '❌');
  console.log('  in viewport:', 
    rect.top >= 0 && rect.left >= 0 && 
    rect.bottom <= window.innerHeight && 
    rect.right <= window.innerWidth ? '✅' : '❌');
  
  // Container
  console.log('\n[5] Container');
  console.log('  parent:', container?.className || '❌ NO PARENT');
  console.log('  parent position:', container ? window.getComputedStyle(container).position : 'N/A');
  console.log('  parent overflow:', container ? window.getComputedStyle(container).overflow : 'N/A');
  console.log('  container rect:', containerRect ? `${containerRect.width}x${containerRect.height}` : 'N/A');
  console.log('  overlay in container:', containerRect ? 
    (rect.top >= containerRect.top - 10 && 
     rect.left >= containerRect.left - 10 && 
     rect.bottom <= containerRect.bottom + 10 && 
     rect.right <= containerRect.right + 10) ? '✅' : '❌ OUT OF BOUNDS' : 'N/A');
  
  // Image
  console.log('\n[6] Image');
  console.log('  src length:', overlay.src?.length || 0, overlay.src ? '✅' : '❌');
  console.log('  complete:', overlay.complete, overlay.complete ? '✅' : '❌');
  console.log('  naturalWidth:', overlay.naturalWidth, overlay.naturalWidth > 0 ? '✅' : '❌');
  console.log('  naturalHeight:', overlay.naturalHeight, overlay.naturalHeight > 0 ? '✅' : '❌');
  
  console.log('\n=== DIAGNOSTIC COMPLETE ===');
})();
```

---

## Next Steps

1. **Run Test 10** (CSS Positioning Check) - Check computed styles
2. **Run Test 11** (Container Structure Check) - Verify container setup
3. **Run Test 12** (Visual Position Check) - See where overlay actually is
4. **Run Test 13** (Image Loading Check) - Verify image loads
5. **Run Quick All-in-One** - Get complete picture

Share the output and we can pinpoint the exact CSS issue.



