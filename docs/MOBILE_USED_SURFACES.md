# MOBILE_USED_SURFACES

- Status: POINTER_ONLY
- Owner repo: backend
- Source of truth for: backend-side ownership bridge only; not current mobile caller-truth
- Canonical counterpart/source: mobile repo `docs/MOBILE_USED_SURFACES.md`
- Last verified against: both repos on 2026-03-07

Current mobile caller-truth lives in the mobile repo.

This backend repo does not own the exact screen/hook/context caller map for the mobile app. Use the mobile repo's `docs/MOBILE_USED_SURFACES.md` for:

- exact routes the mobile app calls now
- request fields mobile sends
- response fields mobile reads
- current screen/context ownership

For backend-owned mobile contract truth in this repo, use:

- `docs/MOBILE_BACKEND_CONTRACT.md`
- `docs/MOBILE_HARDENING_PLAN.md`
- `docs/LEGACY_WEB_SURFACES.md`
- `docs/API_CONTRACT.md`
- `docs/COHESION_GUARDRAILS.md`

Do not recreate a second full mobile caller-truth matrix in this repo.