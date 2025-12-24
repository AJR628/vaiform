# Caption Pipeline Documentation

**Start here** - Complete SSOT documentation for the caption rendering pipeline.

## Documentation Index

1. **[Pipeline Overview](01-pipeline-overview.md)**
   - Complete 6-stage pipeline map (DOM → Preview → Render)
   - Data flow diagrams
   - Field production/consumption table
   - Canonical semantics & ownership

2. **[Meta Contract - V3 Raster Mode](02-meta-contract-v3-raster.md)**
   - Complete field semantics dictionary
   - Request/response schemas
   - Server authority on rewrap
   - Locked invariants

3. **[Debugging Parity Guide](03-debugging-parity.md)**
   - Verification checklists
   - Common mismatches & fixes
   - Debug flags & test functions
   - End-to-end parity verification

## Quick Reference

- **yPx_png**: TOP-left Y coordinate (invariant)
- **Beat previews**: TOP-anchored (no `translateY(-50%)`)
- **FFmpeg overlay**: Uses `yPx_png` as top-left
- **Server rewrap**: May change `lines`/`totalTextH`/`rasterH`, but `yPx_png` stays unchanged

## Legacy Documentation

- [`../caption-meta-contract.md`](../caption-meta-contract.md) - Legacy contract (deprecated, V3 raster supersedes)

