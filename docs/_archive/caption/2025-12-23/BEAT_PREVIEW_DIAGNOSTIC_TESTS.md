# Beat Preview Diagnostic Test Plan

## Setup

1. **Open browser DevTools** (F12)
2. **Enable debug flags**:
   ```javascript
   window.BEAT_PREVIEW_ENABLED = true;
   window.__beatPreviewDebug = true;
   ```
3. **Clear console** (Ctrl+L or right-click → Clear console)

---

## Test 1: Feature Flag Check

**Purpose**: Verify feature flag is enabled and accessible

**Steps**:
```javascript
console.log('BEAT_PREVIEW_ENABLED:', window.BEAT_PREVIEW_ENABLED);
console.log('__beatPreviewDebug:', window.__beatPreviewDebug);
```

**Expected**: Both should be `true`

**If FAIL**: Feature flag not set correctly

---

## Test 2: Function Availability Check

**Purpose**: Verify functions are loaded and accessible

**Steps**:
```javascript
import('./js/caption-preview.js').then(module => {
  console.log('generateBeatCaptionPreviewDebounced:', typeof module.generateBeatCaptionPreviewDebounced);
  console.log('applyPreviewResultToBeatCard:', typeof module.applyPreviewResultToBeatCard);
  console.log('generateBeatCaptionPreview:', typeof module.generateBeatCaptionPreview);
});
```

**Expected**: All three should be `"function"`

**If FAIL**: Module not loaded or function not exported

---

## Test 3: Manual Debounce Call

**Purpose**: Test if debounce function executes without errors

**Steps**:
1. Find a beat card in the DOM:
   ```javascript
   const beatCard = document.querySelector('[data-beat-id]') || document.querySelector('[data-sentence-index]');
   console.log('Beat card found:', beatCard);
   const identifier = beatCard?.getAttribute('data-beat-id') || beatCard?.getAttribute('data-sentence-index');
   console.log('Identifier:', identifier);
   ```

2. Get beat text:
   ```javascript
   const textEl = beatCard?.querySelector('.beat-text');
   const text = textEl?.textContent?.trim() || 'Test caption text';
   console.log('Text:', text);
   ```

3. Get style (use defaults if not available):
   ```javascript
   const style = window.draftStoryboard?.captionStyle || 
                 window.currentStorySession?.overlayCaption || 
                 window.currentStorySession?.captionStyle || {
                   fontFamily: 'DejaVu Sans',
                   weightCss: 'bold',
                   fontPx: 48,
                   yPct: 0.5,
                   wPct: 0.8,
                   opacity: 1,
                   color: '#FFFFFF'
                 };
   console.log('Style:', style);
   ```

4. Call debounce function manually:
   ```javascript
   import('./js/caption-preview.js').then(module => {
     module.generateBeatCaptionPreviewDebounced(identifier, text, style);
     console.log('Debounce called, waiting 350ms...');
     setTimeout(() => {
       console.log('Check console for logs and DOM for overlay');
     }, 350);
   });
   ```

**Expected**: 
- Console logs: `[beat-preview] Debounce triggered`
- After 300ms: `[beat-preview] Card found` or `[beat-preview] Card not found`
- If found: `[beat-preview] Overlay applied`

**If FAIL**: Check console errors, verify identifier matches DOM attribute

---

## Test 4: Manual Generate Call (Bypass Debounce)

**Purpose**: Test if `generateBeatCaptionPreview()` works independently

**Steps**:
```javascript
import('./js/caption-preview.js').then(async module => {
  const identifier = document.querySelector('[data-beat-id]')?.getAttribute('data-beat-id') || 
                     document.querySelector('[data-sentence-index]')?.getAttribute('data-sentence-index');
  const text = 'Test caption text';
  const style = {
    fontFamily: 'DejaVu Sans',
    weightCss: 'bold',
    fontPx: 48,
    yPct: 0.5,
    wPct: 0.8,
    opacity: 1,
    color: '#FFFFFF'
  };
  
  console.log('Calling generateBeatCaptionPreview...');
  const result = await module.generateBeatCaptionPreview(identifier, text, style);
  console.log('Result:', result);
  console.log('Has rasterUrl:', !!result?.rasterUrl);
  console.log('Has meta:', !!result?.meta);
  if (result?.meta) {
    console.log('Meta keys:', Object.keys(result.meta));
    console.log('yPx_png:', result.meta.yPx_png);
    console.log('frameH:', result.meta.frameH);
    console.log('rasterW:', result.meta.rasterW);
    console.log('rasterH:', result.meta.rasterH);
  }
});
```

**Expected**: 
- `result` is an object
- `result.rasterUrl` is a string starting with `"data:image/png;base64,"`
- `result.meta` contains all required fields

**If FAIL**: Check Network tab for `/api/caption/preview` request, check console errors

---

## Test 5: Manual Apply Call (Bypass Generate)

**Purpose**: Test if `applyPreviewResultToBeatCard()` works with mock data

**Steps**:
```javascript
import('./js/caption-preview.js').then(module => {
  const beatCard = document.querySelector('[data-beat-id]') || document.querySelector('[data-sentence-index]');
  console.log('Beat card:', beatCard);
  
  // Create mock result
  const mockResult = {
    rasterUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
    meta: {
      yPx_png: 960,
      frameH: 1920,
      rasterW: 500,
      frameW: 1080,
      rasterH: 150
    }
  };
  
  console.log('Calling applyPreviewResultToBeatCard with mock data...');
  module.applyPreviewResultToBeatCard(beatCard, mockResult);
  
  // Check if overlay was created
  const overlay = beatCard?.querySelector('.beat-caption-overlay');
  console.log('Overlay element:', overlay);
  if (overlay) {
    console.log('Overlay src:', overlay.src?.substring(0, 50) + '...');
    console.log('Overlay display:', overlay.style.display);
    console.log('CSS vars:', {
      '--y-pct': overlay.style.getPropertyValue('--y-pct'),
      '--raster-w-ratio': overlay.style.getPropertyValue('--raster-w-ratio'),
      '--raster-h-ratio': overlay.style.getPropertyValue('--raster-h-ratio')
    });
  }
});
```

**Expected**:
- Overlay `<img>` element exists in beat card
- `overlay.src` is set to mock data URL
- `overlay.style.display` is `"block"`
- CSS variables are set

**If FAIL**: Check if beatCard is null, check console errors

---

## Test 6: Full Pipeline Test (Generate + Apply)

**Purpose**: Test complete pipeline end-to-end

**Steps**:
```javascript
import('./js/caption-preview.js').then(async module => {
  const beatCard = document.querySelector('[data-beat-id]') || document.querySelector('[data-sentence-index]');
  const identifier = beatCard?.getAttribute('data-beat-id') || beatCard?.getAttribute('data-sentence-index');
  const text = 'Test caption text';
  const style = {
    fontFamily: 'DejaVu Sans',
    weightCss: 'bold',
    fontPx: 48,
    yPct: 0.5,
    wPct: 0.8,
    opacity: 1,
    color: '#FFFFFF'
  };
  
  console.log('Step 1: Generating preview...');
  const result = await module.generateBeatCaptionPreview(identifier, text, style);
  console.log('Step 1 result:', result);
  
  if (result && result.rasterUrl) {
    console.log('Step 2: Applying to DOM...');
    module.applyPreviewResultToBeatCard(beatCard, result);
    
    console.log('Step 3: Checking DOM...');
    const overlay = beatCard?.querySelector('.beat-caption-overlay');
    console.log('Overlay exists:', !!overlay);
    if (overlay) {
      console.log('Overlay visible:', overlay.offsetWidth > 0 && overlay.offsetHeight > 0);
      console.log('Overlay computed style:', window.getComputedStyle(overlay).display);
    }
  } else {
    console.error('Step 1 failed: No result or rasterUrl');
  }
});
```

**Expected**: Overlay appears on beat card

**If FAIL**: Check which step failed

---

## Test 7: Edit Handler Integration Test

**Purpose**: Verify edit handler actually calls debounce function

**Steps**:
1. **Monitor function calls**:
   ```javascript
   import('./js/caption-preview.js').then(module => {
     const originalDebounce = module.generateBeatCaptionPreviewDebounced;
     let callCount = 0;
     module.generateBeatCaptionPreviewDebounced = function(...args) {
       callCount++;
       console.log('[TEST] generateBeatCaptionPreviewDebounced called:', { callCount, args });
       return originalDebounce.apply(this, args);
     };
     console.log('Monitoring enabled. Edit a beat text now.');
   });
   ```

2. **Edit a beat text** (click text, type, press Enter)

3. **Check console** for `[TEST] generateBeatCaptionPreviewDebounced called`

**Expected**: Function is called with correct arguments

**If FAIL**: Edit handler not wired correctly

---

## Test 8: Network Request Check

**Purpose**: Verify `/api/caption/preview` request is made

**Steps**:
1. **Open Network tab** in DevTools
2. **Filter by**: `/caption/preview`
3. **Edit a beat text**
4. **Wait 300ms**
5. **Check Network tab**:
   - Request appears?
   - Status code? (should be 200)
   - Request payload? (check if all required fields present)
   - Response? (check if `ok: true` and `meta.rasterUrl` exists)

**Expected**: Request appears after 300ms with 200 status

**If FAIL**: 
- No request = debounce not calling generate
- 400/500 = payload or server issue
- 200 but no rasterUrl = server response issue

---

## Test 9: DOM Selector Check

**Purpose**: Verify beat card can be found by selector

**Steps**:
```javascript
// Check draft mode selector
const draftCards = document.querySelectorAll('[data-beat-id]');
console.log('Draft mode cards found:', draftCards.length);
draftCards.forEach((card, i) => {
  const id = card.getAttribute('data-beat-id');
  console.log(`Card ${i}: data-beat-id="${id}"`);
});

// Check session mode selector
const sessionCards = document.querySelectorAll('[data-sentence-index]');
console.log('Session mode cards found:', sessionCards.length);
sessionCards.forEach((card, i) => {
  const idx = card.getAttribute('data-sentence-index');
  console.log(`Card ${i}: data-sentence-index="${idx}"`);
});

// Test selector used in debounce
const testId = draftCards[0]?.getAttribute('data-beat-id') || sessionCards[0]?.getAttribute('data-sentence-index');
if (testId) {
  const found = document.querySelector(`[data-beat-id="${testId}"]`) || 
                document.querySelector(`[data-sentence-index="${testId}"]`);
  console.log('Selector test - found:', !!found, 'for identifier:', testId);
}
```

**Expected**: Cards found and selector works

**If FAIL**: Identifier mismatch or DOM structure issue

---

## Test 10: CSS Variable Check

**Purpose**: Verify CSS variables are set correctly

**Steps**:
```javascript
const overlay = document.querySelector('.beat-caption-overlay');
if (overlay) {
  const computed = window.getComputedStyle(overlay);
  console.log('CSS Variables:');
  console.log('  --y-pct:', overlay.style.getPropertyValue('--y-pct'));
  console.log('  --raster-w-ratio:', overlay.style.getPropertyValue('--raster-w-ratio'));
  console.log('  --raster-h-ratio:', overlay.style.getPropertyValue('--raster-h-ratio'));
  console.log('Computed styles:');
  console.log('  display:', computed.display);
  console.log('  position:', computed.position);
  console.log('  top:', computed.top);
  console.log('  width:', computed.width);
  console.log('  height:', computed.height);
  console.log('  z-index:', computed.zIndex);
} else {
  console.log('No overlay found');
}
```

**Expected**: CSS variables set, overlay visible

**If FAIL**: CSS variables not set or overlay hidden

---

## Test 11: Container Check

**Purpose**: Verify overlay is inserted into correct container

**Steps**:
```javascript
const beatCard = document.querySelector('[data-beat-id]') || document.querySelector('[data-sentence-index]');
const videoContainer = beatCard?.querySelector('.relative.w-full.h-40');
console.log('Beat card:', beatCard);
console.log('Video container (.relative.w-full.h-40):', videoContainer);
console.log('Overlay in video container:', videoContainer?.querySelector('.beat-caption-overlay'));
console.log('Overlay in beat card:', beatCard?.querySelector('.beat-caption-overlay'));
```

**Expected**: Overlay exists in video container or beat card

**If FAIL**: Container selector issue

---

## Diagnostic Checklist

Run tests in order and mark results:

- [ ] Test 1: Feature flag enabled
- [ ] Test 2: Functions available
- [ ] Test 3: Manual debounce call works
- [ ] Test 4: Manual generate call works
- [ ] Test 5: Manual apply call works
- [ ] Test 6: Full pipeline works
- [ ] Test 7: Edit handler calls debounce
- [ ] Test 8: Network request made
- [ ] Test 9: DOM selector finds card
- [ ] Test 10: CSS variables set
- [ ] Test 11: Container correct

---

## Common Failure Patterns

### Pattern A: No console logs at all
- **Cause**: Feature flag not enabled or edit handler not wired
- **Fix**: Check `window.BEAT_PREVIEW_ENABLED` and edit handler code

### Pattern B: "Debounce triggered" but no "Card found"
- **Cause**: Identifier mismatch or DOM not ready
- **Fix**: Check identifier type (string vs number), verify DOM structure

### Pattern C: "Card found" but no "Overlay applied"
- **Cause**: `applyPreviewResultToBeatCard()` failing silently
- **Fix**: Check console errors, verify result has `rasterUrl`

### Pattern D: "Overlay applied" but no visible overlay
- **Cause**: CSS issue or container not found
- **Fix**: Check CSS variables, verify overlay in correct container, check z-index

### Pattern E: Network request fails
- **Cause**: Payload issue or server error
- **Fix**: Check request payload, verify server response

---

## Quick Diagnostic Script

Run this all-in-one diagnostic:

```javascript
(async function() {
  window.BEAT_PREVIEW_ENABLED = true;
  window.__beatPreviewDebug = true;
  
  console.log('=== BEAT PREVIEW DIAGNOSTIC ===');
  
  // Test 1: Flags
  console.log('\n[1] Feature flags:', {
    enabled: window.BEAT_PREVIEW_ENABLED,
    debug: window.__beatPreviewDebug
  });
  
  // Test 2: Functions
  const module = await import('./js/caption-preview.js');
  console.log('\n[2] Functions available:', {
    debounce: typeof module.generateBeatCaptionPreviewDebounced,
    apply: typeof module.applyPreviewResultToBeatCard,
    generate: typeof module.generateBeatCaptionPreview
  });
  
  // Test 3: DOM
  const beatCard = document.querySelector('[data-beat-id]') || document.querySelector('[data-sentence-index]');
  const identifier = beatCard?.getAttribute('data-beat-id') || beatCard?.getAttribute('data-sentence-index');
  console.log('\n[3] DOM check:', {
    beatCardFound: !!beatCard,
    identifier: identifier,
    identifierType: typeof identifier
  });
  
  // Test 4: Manual generate
  const text = 'Test text';
  const style = { fontFamily: 'DejaVu Sans', weightCss: 'bold', fontPx: 48, yPct: 0.5, wPct: 0.8, opacity: 1, color: '#FFFFFF' };
  console.log('\n[4] Generating preview...');
  const result = await module.generateBeatCaptionPreview(identifier, text, style);
  console.log('[4] Generate result:', {
    hasResult: !!result,
    hasRasterUrl: !!result?.rasterUrl,
    hasMeta: !!result?.meta
  });
  
  // Test 5: Manual apply
  if (result && result.rasterUrl && beatCard) {
    console.log('\n[5] Applying to DOM...');
    module.applyPreviewResultToBeatCard(beatCard, result);
    const overlay = beatCard.querySelector('.beat-caption-overlay');
    console.log('[5] Apply result:', {
      overlayExists: !!overlay,
      overlaySrc: overlay?.src?.substring(0, 30) + '...',
      overlayDisplay: overlay?.style.display,
      cssVars: overlay ? {
        yPct: overlay.style.getPropertyValue('--y-pct'),
        wRatio: overlay.style.getPropertyValue('--raster-w-ratio'),
        hRatio: overlay.style.getPropertyValue('--raster-h-ratio')
      } : null
    });
  }
  
  console.log('\n=== DIAGNOSTIC COMPLETE ===');
})();
```



