# Caption Preview API Contract

**⚠️ DEPRECATED**: This document is legacy and does not cover V3 raster mode.

**Current SSOT Documentation**:
- [`caption/01-pipeline-overview.md`](caption/01-pipeline-overview.md) - Complete pipeline map (6 stages)
- [`caption/02-meta-contract-v3-raster.md`](caption/02-meta-contract-v3-raster.md) - V3 raster mode contract
- [`caption/03-debugging-parity.md`](caption/03-debugging-parity.md) - Parity debugging guide

**Legacy Note**: This document defines the old caption preview API contract. The current system uses **SSOT v3 raster mode** with different field semantics. See the V3 contract docs above for current implementation details.

---

This document defines the client↔server contract for caption preview generation and overlay positioning.

## Request Body (captionStyle)

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `text` | string | required | Caption text content |
| `fontFamily` | string | "DejaVuSans" | Font family (maps to server fonts) |
| `weight` | string | "bold" | Font weight: "normal" \| "bold" |
| `sizePx` | number | 48 | Font size in pixels (32-120 range) |
| `color` | string | "#FFFFFF" | Text color (hex) |
| `opacity` | number | 0.85 | Text opacity (0-1) |
| `placement` | string | "center" | Placement: "top" \| "center" \| "bottom" |
| `lineHeight` | number | 1.05 | Line height multiplier |
| `padding` | number | 24 | Internal padding in pixels |
| `maxWidthPct` | number | 0.90 | Max width as percentage (0-1) |
| `borderRadius` | number | 16 | Border radius in pixels |
| `showBox` | boolean | false | Show background box |
| `boxColor` | string | "rgba(0,0,0,0.35)" | Box color with alpha |

## Response Body (meta)

| Field | Type | Description |
|-------|------|-------------|
| `yPct` | number (0-1) | Vertical position percentage (0=top, 0.5=center, 1=bottom) |
| `totalTextH` | number (px) | Total text block height in pixels |
| `lineSpacingPx` | number (px) | Line spacing in pixels |
| `fontPx` | number (px) | Actual font size used (may differ from requested) |
| `placement` | string | Normalized placement: "top" \| "center" \| "bottom" |
| `internalPadding` | number (px) | Internal padding applied |
| `safeTopMarginPct` | number (0-1) | Top safe margin percentage |
| `safeBottomMarginPct` | number (0-1) | Bottom safe margin percentage |
| `fontFamilyUsed` | string | Actual font family used by server |
| `splitLines` | string[] | Text split into lines |
| `baselines` | number[] | Y positions of each line baseline |

## Constants That Must Match

- **Font Size Range**: `ABS_MIN_FONT = 32`, `ABS_MAX_FONT = 120`
- **Safe Margins**: `safeTopMarginPct = 0.10` (10%), `safeBottomMarginPct = 0.10` (10%)
- **Canvas Dimensions**: `1080×1920` pixels (portrait)

## Font Mapping Table

| Client Input | Server Font Family |
|--------------|-------------------|
| "DejaVuSans" | "DejaVu-Bold" |
| "DejaVu Sans Local" | "DejaVu-Bold" |
| "DejaVu Serif Local" | "DejaVu Serif" |
| "DejaVu Serif Bold Local" | "DejaVu Serif Bold" |

## Positioning Rules

1. **Wire Protocol**: Use `placement` field in requests ("top" \| "center" \| "bottom")
2. **Client Positioning**: Use `yPct` from server response meta for precise positioning
3. **No Client vAlign**: Client does not implement vertical alignment logic - relies entirely on server-computed `yPct`
4. **Safe Margins**: Both client and server respect safe margin percentages to prevent clipping

## Error Handling

- Invalid font sizes are clamped to valid range (32-120)
- Invalid placements default to "center"
- Missing text returns 400 error
- Failed font registration falls back to system fonts
