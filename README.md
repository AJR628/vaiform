# Start Here (Repo Bible)

This repository’s source of truth is concentrated in five docs:

- [`VAIFORM_REPO_COHESION_AUDIT.md`](./VAIFORM_REPO_COHESION_AUDIT.md) — top-level cohesion audit and governance snapshot.
- [`ROUTE_TRUTH_TABLE.md`](./ROUTE_TRUTH_TABLE.md) — code-evidenced route truth, reachability, and caller-backing.
- [`docs/ACTIVE_SURFACES.md`](./docs/ACTIVE_SURFACES.md) — default runtime active surface map (dist-aware).
- [`docs/COHESION_GUARDRAILS.md`](./docs/COHESION_GUARDRAILS.md) — guardrails for consistency and safe change boundaries.
- [`docs/API_CONTRACT.md`](./docs/API_CONTRACT.md) — API contract expectations for request/response behavior.

Defaults and precedence to remember:

- Default flags: `ENABLE_LEGACY_ROUTES=0`, `VAIFORM_DEBUG=0`.
- Dist-first runtime precedence: `web/dist` is served before `public` when present.
- Line endings: `.gitattributes` normalizes repo text files to LF; Prettier uses `endOfLine: "auto"` for cross-platform check stability.
- Route-change rule: when routes/callers change, update both:
  - `ROUTE_TRUTH_TABLE.md`
  - `docs/ACTIVE_SURFACES.md`
