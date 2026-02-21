# Start Here (Repo Bible)

This repository's source of truth is concentrated in five docs:

- `VAIFORM_REPO_COHESION_AUDIT.md` - top-level cohesion and architecture snapshot.
- `ROUTE_TRUTH_TABLE.md` - active route inventory and status.
- `docs/ACTIVE_SURFACES.md` - caller-backed production surfaces.
- `docs/COHESION_GUARDRAILS.md` - guardrails for consistency and safe change boundaries.
- `docs/API_CONTRACT.md` - API response contract.

Defaults and precedence:

- Default flags: `VAIFORM_DEBUG=0`.
- Frontend source of truth: `web/public`.
- Netlify build root: `web`, publish dir: `dist`.
- Backend posture: API-only (no frontend HTML/static hosting).
- Backend still serves required fonts at `/assets/fonts/*`.
- Route-change rule: when routes/callers change, update both:
  - `ROUTE_TRUTH_TABLE.md`
  - `docs/ACTIVE_SURFACES.md`

Netlify redirect/proxy rules are managed in `netlify.toml`.
