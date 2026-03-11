# DOCS_INDEX

- Status: CANONICAL
- Owner repo: backend
- Source of truth for: backend docs ownership, precedence, and the mobile/backend documentation split
- Canonical counterpart/source: mobile repo `docs/DOCS_INDEX.md` and mobile repo `docs/MOBILE_USED_SURFACES.md`
- Last verified against: both repos on 2026-03-07

## Ownership Split

- The mobile repo owns current mobile caller-truth: exact screens, hooks, contexts, request payloads, and response fields read now.
- The backend repo owns server contract truth, backend guarantees, hardening status, and legacy surface classification.
- When mobile/backend contract work changes, verify actual code in both repos first, then update the owning doc set.

## Backend Canonical Docs

Update these first when backend/mobile contract or hardening truth changes:

- `docs/MOBILE_BACKEND_CONTRACT.md`
- `docs/MOBILE_HARDENING_PLAN.md`
- `docs/TIME_BASED_RENDER_USAGE_MIGRATION_PLAN.md`
- `docs/LEGACY_WEB_SURFACES.md`
- `docs/API_CONTRACT.md`
- `docs/COHESION_GUARDRAILS.md`

## Canonical Mobile Counterparts

Do not duplicate these in the backend repo:

- mobile repo `docs/DOCS_INDEX.md`
- mobile repo `docs/MOBILE_USED_SURFACES.md`
- mobile repo `docs/MOBILE_BACKEND_CONTRACT.md` (consumer-note only)

## Evidence Docs

Useful for audits and paper trail, but not the first place to update when contract truth changes:

- `docs/MOBILE_DOCS_VERIFICATION_REPORT.md`
- `ROUTE_TRUTH_TABLE.md`
- `docs/ACTIVE_SURFACES.md`
- `VAIFORM_REPO_COHESION_AUDIT.md`
- `docs/TRUTH_FREEZE_AUDIT_2026-02-28.md`

## Historical / Stale Docs

Kept for history only. Do not treat them as current contract truth:

- `docs/BETA_HARDENING_PLAN.md`
- `docs/security-notes.md`
- `docs/MOBILE_SPEC_PACK.md`
- `docs/vaiform-v1-scope.md`

## Update Rule

If a mobile/backend contract change affects current mobile usage:

1. Verify the mobile caller in the mobile repo.
2. Verify the backend route/controller/service/middleware in this repo.
3. Update mobile caller-truth in the mobile repo.
4. Update backend contract/hardening/legacy docs in this repo.
5. Leave evidence and historical docs as references unless they need a banner or pointer refresh.
