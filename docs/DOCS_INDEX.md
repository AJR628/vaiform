# DOCS_INDEX

- Status: CANONICAL
- Owner repo: backend
- Source of truth for: backend docs ownership, precedence, and the mobile/backend documentation split
- Canonical counterpart/source: mobile repo `docs/DOCS_INDEX.md` and mobile repo `docs/MOBILE_USED_SURFACES.md`
- Last verified against: both repos on 2026-04-04

## Ownership Split

- The mobile repo owns current mobile caller-truth: exact screens, hooks, contexts, request payloads, and response fields read now.
- The backend repo owns server contract truth, backend guarantees, hardening status, and legacy surface classification.
- When mobile/backend contract work changes, verify actual code in both repos first, then update the owning doc set.

## Active Docs Map

Start here for current live truth and update-first docs:

- backend repo `README.md`
- backend repo `docs/DOCS_INDEX.md`
- backend repo `docs/FINAL_PAID_BETA_LAUNCH_PLAN.md` - current launch-phase authority after Phases 1-3 closure
- backend repo `docs/API_CONTRACT.md`
- backend repo `docs/FINALIZE_CURRENT_STATE_AUDIT.md`
- backend repo `docs/FINALIZE_OBSERVABILITY_SPEC.md`
- backend repo `docs/FINALIZE_RUNTIME_TOPOLOGY_SPEC.md`
- backend repo `docs/FINALIZE_CONTROL_ROOM_DASHBOARD.md`
- backend repo `docs/SCRIPT_CONTROL_PREIMPLEMENTATION_AUDIT.md`
- backend repo `docs/MOBILE_BACKEND_CONTRACT.md`
- backend repo `docs/MOBILE_HARDENING_PLAN.md`
- backend repo `docs/LEGACY_WEB_SURFACES.md`
- mobile repo `docs/MOBILE_USED_SURFACES.md`

Operational runbooks that stay current but are not the first contract docs:

- backend repo `docs/DEPLOY_ROLLBACK_HOTFIX_RUNBOOK.md`
- backend repo `docs/INCIDENT_TRACE_RUNBOOK.md`

Phase-scoped or reference docs that remain useful, but must be re-verified against code before treating them as live truth:

- backend repo `docs/CROSS_REPO_PRODUCTION_HARDENING_PLAN.md`
- backend repo `docs/FINALIZE_FACTORY_CONVERSION_PLAN.md`
- backend repo `docs/FINALIZE_JOB_MODEL_SPEC.md`
- backend repo `docs/FINALIZE_OBSERVABILITY_COVERAGE_MATRIX.md`
- backend repo `docs/FINALIZE_DASHBOARD_ARTIFACTS.md`
- backend repo `docs/FINALIZE_ALERT_ARTIFACTS.md`
- backend repo `docs/TIME_BASED_RENDER_USAGE_MIGRATION_PLAN.md`

Do not start from evidence, historical, or phase/reference docs unless the live-truth docs above or current code send you there.

## Backend Live Canonical Docs

Update these first when backend/mobile contract or hardening truth changes:

- `docs/FINAL_PAID_BETA_LAUNCH_PLAN.md`
- `docs/SCRIPT_CONTROL_PREIMPLEMENTATION_AUDIT.md`
- `docs/FINALIZE_CURRENT_STATE_AUDIT.md`
- `docs/FINALIZE_OBSERVABILITY_SPEC.md`
- `docs/FINALIZE_RUNTIME_TOPOLOGY_SPEC.md`
- `docs/FINALIZE_CONTROL_ROOM_DASHBOARD.md`
- `docs/MOBILE_BACKEND_CONTRACT.md`
- `docs/MOBILE_HARDENING_PLAN.md` - current hardening-status ledger, not the primary launch-phase front door
- `docs/LEGACY_WEB_SURFACES.md`
- `docs/API_CONTRACT.md`
- `docs/COHESION_GUARDRAILS.md`

Operational runbooks:

- `docs/DEPLOY_ROLLBACK_HOTFIX_RUNBOOK.md`
- `docs/INCIDENT_TRACE_RUNBOOK.md`

Phase/reference docs only. Re-verify against code before editing them as live truth:

- `docs/CROSS_REPO_PRODUCTION_HARDENING_PLAN.md`
- `docs/FINALIZE_FACTORY_CONVERSION_PLAN.md`
- `docs/FINALIZE_JOB_MODEL_SPEC.md`
- `docs/FINALIZE_OBSERVABILITY_COVERAGE_MATRIX.md`
- `docs/FINALIZE_DASHBOARD_ARTIFACTS.md`
- `docs/FINALIZE_ALERT_ARTIFACTS.md`
- `docs/TIME_BASED_RENDER_USAGE_MIGRATION_PLAN.md`

## Canonical Mobile Counterparts

Do not duplicate these in the backend repo:

- mobile repo `docs/DOCS_INDEX.md`
- mobile repo `docs/MOBILE_USED_SURFACES.md`
- mobile repo `docs/MOBILE_BACKEND_CONTRACT.md` (consumer-note only)

Backend bridge/pointer only:

- `docs/MOBILE_USED_SURFACES.md` - backend-side pointer to the mobile repo's caller-truth doc; not a second caller matrix

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
- `docs/REPO_ARCHITECTURE_DIAGRAM.md`

## Archive-First Rule

If overlapping stale docs still look live:

1. Move them to archive first or add a strong historical banner with a canonical pointer.
2. Keep them searchable until the canonical docs are confirmed complete and accurate.
3. Delete archived copies later only when they no longer contain unique operational truth.

## Update Rule

If a mobile/backend contract change affects current mobile usage:

1. Verify the mobile caller in the mobile repo.
2. Verify the backend route/controller/service/middleware in this repo.
3. Update mobile caller-truth in the mobile repo.
4. Update backend contract/hardening/legacy docs in this repo.
5. Leave evidence and historical docs as references unless they need a banner or pointer refresh.
