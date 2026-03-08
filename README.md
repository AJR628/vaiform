# Start Here (Repo Bible)

This repository's mobile-first docs front door is:

- `docs/DOCS_INDEX.md` - backend docs ownership, precedence, and canonical set.
- `docs/MOBILE_BACKEND_CONTRACT.md` - backend-owned contract truth for mobile-used routes.
- `docs/MOBILE_HARDENING_PLAN.md` - backend-owned hardening status and next work.
- `docs/LEGACY_WEB_SURFACES.md` - non-mobile route classification and containment.
- `docs/API_CONTRACT.md` - API response contract.
- `docs/COHESION_GUARDRAILS.md` - guardrails for consistency and safe change boundaries.

Defaults and precedence:

- Default flags: `VAIFORM_DEBUG=0`.
- Frontend source of truth: `web/public`.
- Netlify build root: `web`, publish dir: `dist`.
- Backend posture: API-only (no frontend HTML/static hosting).
- Backend still serves required fonts at `/assets/fonts/*`.
- Mobile repo owns current caller-truth; backend repo owns server contract/hardening/legacy docs.
- Evidence and historical docs remain searchable, but they are not the first docs to update for mobile/backend contract work.

Netlify redirect/proxy rules are managed in `netlify.toml`.