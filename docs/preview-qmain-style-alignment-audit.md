# Preview QMain Style Alignment - Audit Findings

## Phase 1: Audit Findings

### 1.1 Server RasterSchema Defaults (`src/routes/caption.preview.routes.js:14-38`)

**Current defaults**:
```22:38:src/routes/caption.preview.routes.js
fontPx: z.coerce.number().int().finite().min(8).max(400),  // ❌ NO DEFAULT
lineSpacingPx: z.coerce.number().int().finite().min(0).max(400).default(0),
letterSpacingPx: z.coerce.number().default(0),  // ✅ Correct (Option A)
weightCss: z.string().default('700'),  // ❌ Should be 'normal'
strokePx: z.coerce.number().default(0),  // ❌ Should be 3
shadowBlur: z.coerce.number().default(12),  // ❌ Should be 0
shadowOffsetX: z.coerce.number().default(0),  // ❌ Should be 1
shadowOffsetY: z.coerce.number().default(2),  // ❌ Should be 1
```

**Issues**: fontPx has no default, all other defaults mismatch QMain ASS style.

### 1.2 Re-Defaulting After Schema Parse

**Location 1** (`src/routes/caption.preview.routes.js:161-162`):
```161:162:src/routes/caption.preview.routes.js
const shadowBlur = data.shadowBlur || 12;  // ❌ BUG: || breaks for 0, overrides schema default
const shadowOffsetY = data.shadowOffsetY || 2;  // ❌ BUG: || breaks for 0, overrides schema default
```

**Location 2** (`src/routes/caption.preview.routes.js:1210-1211`):
```1210:1211:src/routes/caption.preview.routes.js
const shadowBlur = meta.shadowBlur || 12;  // ❌ BUG: || breaks for 0, overrides schema default
const shadowOffsetY = meta.shadowOffsetY || 2;  // ❌ BUG: || breaks for 0, overrides schema default
```

**Issue**: Using `||` for numeric values that can be 0 breaks schema defaults. Should use direct `data.shadowBlur` and `data.shadowOffsetY` (schema already applied defaults).

### 1.3 Client fontPx Fallback Leak (`public/js/caption-preview.js:210`)

```209:213:public/js/caption-preview.js
const fontPx = clamp(
  Number(ensureFontPx || opts.sizePx || opts.fontPx || 48),  // ❌ 48 fallback leaks
  8,
  MAX_FONT_PX
);
```

**Then used in payload** (line 321):
```321:321:public/js/caption-preview.js
fontPx,  // ← This ALWAYS includes fontPx, even if user didn't set it
```

**Issue**: The `|| 48` fallback ensures `fontPx` is always 48 when not set, which leaks into payload and overrides server default.

### 1.4 Client Payload Builder Fallbacks (`public/js/caption-preview.js:320-338`)

```320:338:public/js/caption-preview.js
// Typography
fontPx,  // ← Always included (leak from line 210)
lineSpacingPx,  // ← Always included (clamped)
fontFamily: opts.fontFamily || overlayMeta?.fontFamily || 'DejaVu Sans',  // ❌ Fallback
weightCss: opts.weight || overlayMeta?.weightCss || 'normal',  // ❌ Fallback
fontStyle: domStyles.fontStyle || overlayMeta?.fontStyle || 'normal',  // ❌ Fallback
textAlign: domStyles.textAlign || overlayMeta?.textAlign || 'center',  // ❌ Fallback
letterSpacingPx: domStyles.letterSpacingPx ?? overlayMeta?.letterSpacingPx ?? 0,  // ❌ 0 fallback
textTransform: overlayMeta?.textTransform || 'none',  // ❌ Fallback

// Color & effects
color: opts.color || overlayMeta?.color || '#FFFFFF',  // ❌ Fallback
opacity: Number(opts.opacity ?? overlayMeta?.opacity ?? 0.85),  // ❌ 0.85 fallback
strokePx: domStyles.strokePx ?? overlayMeta?.strokePx ?? 0,  // ❌ 0 fallback
strokeColor: domStyles.strokeColor || overlayMeta?.strokeColor || 'rgba(0,0,0,0.85)',  // ❌ Fallback
shadowColor: domStyles.shadowColor || overlayMeta?.shadowColor || 'rgba(0,0,0,0.6)',  // ❌ Fallback
shadowBlur: domStyles.shadowBlur ?? overlayMeta?.shadowBlur ?? 12,  // ❌ 12 fallback
shadowOffsetX: domStyles.shadowOffsetX ?? overlayMeta?.shadowOffsetX ?? 0,  // ❌ 0 fallback
shadowOffsetY: domStyles.shadowOffsetY ?? overlayMeta?.shadowOffsetY ?? 2,  // ❌ 2 fallback
```

**Issue**: All hardcoded fallbacks override server schema defaults. Client should omit fields if not explicitly set.

### 1.5 Client Fallback Block (`public/creative.html:4680-4698`)

```4682:4698:public/creative.html
const fontPx = guardNum(ssot.fontPx, guardNum(meta.fontPx, 48));  // ❌ 48 fallback
const lineSpacingPx = guardNum(ssot.lineSpacingPx, guardNum(meta.lineSpacingPx, 8));
const letterSpacingPx = guardNum(ssot.letterSpacingPx, 0);  // ✅ Correct (Option A)
const weightCss = ssot.weightCss || meta.weightCss || '700';  // ❌ '700' fallback
const fontStyle = ssot.fontStyle || 'normal';
const textAlign = ssot.textAlign || meta.textAlign || 'center';
const textTransform = ssot.textTransform || 'none';

// Color & effects
const color = ssot.color || meta.color || 'rgb(255,255,255)';
const opacity = guardNum(ssot.opacity, guardNum(meta.opacity, 0.85));
const strokePx = guardNum(ssot.strokePx, 0);  // ❌ 0 fallback
const strokeColor = ssot.strokeColor || 'rgba(0,0,0,0.85)';
const shadowColor = ssot.shadowColor || 'rgba(0,0,0,0.6)';
const shadowBlur = guardNum(ssot.shadowBlur, 12);  // ❌ 12 fallback
const shadowOffsetX = guardNum(ssot.shadowOffsetX, 0);  // ❌ 0 fallback (should be 1)
const shadowOffsetY = guardNum(ssot.shadowOffsetY, 2);  // ❌ 2 fallback
```

**Issue**: Fallbacks mismatch server defaults. Need to update to match QMain: fontPx=64, weightCss='normal', strokePx=3, shadowBlur=0, shadowOffsetX=1, shadowOffsetY=1.

### 1.6 Repo-Wide Hardcoded Defaults Scan

**Found in `public/js/caption-preview.js`**:
- Line 210: `|| 48` (fontPx fallback)
- Line 333: `?? 0` (strokePx fallback)
- Line 336: `?? 12` (shadowBlur fallback)
- Line 338: `?? 2` (shadowOffsetY fallback)
- Line 548: `|| 48` (legacy path fontPx fallback)

**Found in `public/creative.html`**:
- Line 4682: `guardNum(..., 48)` (fontPx)
- Line 4685: `|| '700'` (weightCss)
- Line 4693: `guardNum(..., 0)` (strokePx)
- Line 4696: `guardNum(..., 12)` (shadowBlur)
- Line 4697: `guardNum(..., 0)` (shadowOffsetX)
- Line 4698: `guardNum(..., 2)` (shadowOffsetY)

**Found in `src/routes/caption.preview.routes.js`**:
- Line 118: `|| 0` (letterSpacingPx - but this is OK, schema default is 0)
- Line 161: `|| 12` (shadowBlur re-default)
- Line 162: `|| 2` (shadowOffsetY re-default)
- Line 1210: `|| 12` (shadowBlur re-default)
- Line 1211: `|| 2` (shadowOffsetY re-default)

---

## Phase 2: Updated Plan

### Strategy Confirmation

1. **Option A confirmed**: `letterSpacingPx` default = `0` (defer spacing parity)
2. **Shadow mapping confirmed**: `shadowOffsetX=1`, `shadowOffsetY=1`, `shadowBlur=0` (ASS Shadow=1 is diagonal depth)
3. **Server SSOT**: RasterSchema defaults are source of truth
4. **Client omits fields**: Only include style fields in payload if user explicitly set them; otherwise omit so server defaults apply
5. **Fix numeric bugs**: Use `??` or direct access for numeric defaults, never `||` for values that can be 0

### Field Decision Matrix

| Field | Server Default | Client Action |
|-------|---------------|---------------|
| `fontPx` | 64 | Omit from payload unless user set; fix 48 fallback to 64 or omit |
| `weightCss` | 'normal' | Omit unless user set; remove 'normal' fallback |
| `strokePx` | 3 | Omit unless user set; remove 0 fallback |
| `shadowBlur` | 0 | Omit unless user set; remove 12 fallback |
| `shadowOffsetX` | 1 | Omit unless user set; remove 0 fallback |
| `shadowOffsetY` | 1 | Omit unless user set; remove 2 fallback |
| `letterSpacingPx` | 0 (Option A) | Omit unless user set; remove 0 fallback (schema default already 0) |

### Implementation Approach

**Server**: Update schema defaults + remove re-defaulting + add verification log
**Client JS**: Conditional payload building (omit undefined) + fix fontPx leak
**Client HTML**: Update fallbacks to match server defaults (for cases where fallback is required)

---

## Phase 3: Implementation Changes Summary

### A) Server: `src/routes/caption.preview.routes.js`

1. **RasterSchema defaults** (lines 22-38):
   - Add `fontPx.default(64)`
   - Change `weightCss.default('normal')`
   - Change `strokePx.default(3)`
   - Change `shadowBlur.default(0)`
   - Change `shadowOffsetX.default(1)`
   - Change `shadowOffsetY.default(1)`
   - Keep `letterSpacingPx.default(0)` (Option A)

2. **Remove re-defaulting** (lines 161-162, 1210-1211):
   - Replace `data.shadowBlur || 12` → `data.shadowBlur`
   - Replace `data.shadowOffsetY || 2` → `data.shadowOffsetY`
   - Replace `meta.shadowBlur || 12` → `meta.shadowBlur`
   - Replace `meta.shadowOffsetY || 2` → `meta.shadowOffsetY`

3. **Add verification log** (after line 115, after schema parse):
   ```javascript
   console.log('[preview-style:effective]', {
     fontPx: data.fontPx,
     weightCss: data.weightCss,
     strokePx: data.strokePx,
     shadowBlur: data.shadowBlur,
     shadowOffsetX: data.shadowOffsetX,
     shadowOffsetY: data.shadowOffsetY,
     letterSpacingPx: data.letterSpacingPx
   });
   ```

### B) Client: `public/js/caption-preview.js`

1. **Fix fontPx leak** (line 210):
   - Option: Change `|| 48` to `|| 64` OR conditionally omit from payload
   - Better: Only include `fontPx` in payload if explicitly set

2. **Payload builder** (lines 309-355):
   - Use conditional building: `if (val != null) payload.key = val`
   - Remove all `?? 0`, `?? 12`, `?? 2`, `|| 'normal'` fallbacks
   - Omit fields if `undefined` (server schema applies defaults)

### C) Client: `public/creative.html`

1. **Update fallbacks** (lines 4682-4698):
   - `fontPx`: `guardNum(ssot.fontPx, guardNum(meta.fontPx, 64))` (was 48)
   - `weightCss`: `ssot.weightCss || meta.weightCss || 'normal'` (was '700')
   - `strokePx`: `guardNum(ssot.strokePx, 3)` (was 0)
   - `shadowBlur`: `guardNum(ssot.shadowBlur, 0)` (was 12)
   - `shadowOffsetX`: `guardNum(ssot.shadowOffsetX, 1)` (was 0)
   - `shadowOffsetY`: `guardNum(ssot.shadowOffsetY, 1)` (was 2)
   - `letterSpacingPx`: `guardNum(ssot.letterSpacingPx, 0)` (unchanged, Option A)

---

## Phase 4: Verification Steps

### Test 1: Minimal Payload (Server Defaults Applied)
```bash
curl -X POST http://localhost:3000/api/caption/preview \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "ssotVersion": 3,
    "mode": "raster",
    "text": "Test caption",
    "rasterW": 864,
    "rasterH": 200,
    "yPx_png": 960,
    "lines": ["Test caption"],
    "totalTextH": 64,
    "yPxFirstLine": 960
  }'
```

**Expected log**: `[preview-style:effective]` should show:
```javascript
{
  fontPx: 64,
  weightCss: 'normal',
  strokePx: 3,
  shadowBlur: 0,
  shadowOffsetX: 1,
  shadowOffsetY: 1,
  letterSpacingPx: 0
}
```

### Test 2: Karaoke Render Unchanged
Generate a render and check the ASS file:
```bash
# Check generated .ass file for QMain Style line:
# Style: QMain, DejaVu Sans, 64, ... Bold: 0, ... Outline: 3, Shadow: 1, Spacing: 0.5
```

**Expected**: QMain style unchanged (Bold: 0, Outline: 3, Shadow: 1, Spacing: 0.5)

### Test 3: Visual Comparison
- Generate beat preview PNG with minimal payload
- Generate karaoke render frame with same text
- Compare: weight, size, outline thickness, shadow depth should match

