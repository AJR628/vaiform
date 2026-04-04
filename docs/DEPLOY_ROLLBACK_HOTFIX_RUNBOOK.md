# DEPLOY_ROLLBACK_HOTFIX_RUNBOOK

Last verified against repo code: 2026-04-04.

Purpose: repo-scoped deploy, rollback, and hotfix guidance for the Vaiform backend's mobile-used surface.

## Scope

- Release preflight for the backend repo's current CI and contract/security checks
- Repo-managed Firestore rules/index deployment prerequisite
- Provider-agnostic deploy, rollback, and hotfix checklists
- Incident handoff into the canonical trace runbook

## Current repo-owned operational surface

- `.github/workflows/ci.yml` is the current full CI lane for lint, contract checks, response checks, and security checks.
- `.github/workflows/health.yml` is the current health-check workflow for `/health`.
- `firebase.json` is the repo-owned source for the Firestore rules/index deployment bundle.
- `docs/INCIDENT_TRACE_RUNBOOK.md` is the canonical incident-trace companion for finalize, short-detail, and usage mismatch support work.

## Preflight checklist

1. Confirm the active docs front door still points to this runbook and to `docs/INCIDENT_TRACE_RUNBOOK.md`.
2. Confirm the current backend CI and health workflows are green, or rerun the equivalent repo checks before deploy.
3. Confirm any mobile-facing contract change is already reflected in backend canonical docs and in the mobile repo's caller-truth docs.
4. Confirm whether the release changes `firebase.json`, `firestore.rules`, or `firestore.indexes.json`.
5. Record the intended release commit SHA and operator notes outside the repo.

## Deploy checklist

1. From the backend repo root, run the current repo-owned checks used for this surface:
   - `npm run lint`
   - `npm run test:contracts`
   - `npm run test:security`
2. If Firestore rules or indexes changed, deploy the repo-managed Firestore bundle with `firebase deploy --project <firebase-project-id> --only firestore`.
3. Deploy the backend application with the hosting/provider mechanism used by the live environment. That provider-specific step is not represented in repo code.
4. Verify `/health` from the deployed environment.
5. Verify at least one authenticated mobile-used backend path from the deployed environment before calling the release complete. Use `GET /api/usage` first when a low-risk authenticated probe is needed.
6. If the release touches finalize, short-detail, or usage behavior, keep `docs/INCIDENT_TRACE_RUNBOOK.md` open during verification so requestId-based tracing is ready immediately.

## Rollback checklist

1. Re-deploy the last known good backend application artifact/version with the hosting/provider mechanism used by the live environment.
2. If the bad release changed Firestore rules or indexes and rollback requires the prior definitions, redeploy the matching repo version's Firestore bundle.
3. Re-verify `/health`.
4. Re-verify at least one authenticated mobile-used backend path, starting with `GET /api/usage` when possible.
5. If the issue persists after rollback, switch to `docs/INCIDENT_TRACE_RUNBOOK.md` and trace by requestId before widening the blast radius.

## Hotfix checklist

1. Keep the diff minimal and scoped to the proven failure.
2. Re-run the same repo-owned checks as a normal deploy.
3. Confirm whether the hotfix also requires a Firestore rules/index deploy.
4. Record the incident requestId, affected route, and exact hotfix commit SHA outside the repo.
5. After deploy, run the same verification steps as the normal deploy path.

## Phase 4 Verified Live Probes

The 2026-04-04 Phase 4 operator rehearsal re-verified these live probes on the intended launch environment:

- `GET /health`
- founder-authenticated `GET /api/admin/finalize/data`
- `GET /api/story/:sessionId` recovery confirmation after finalize
- `GET /api/shorts/:jobId`
- `GET /api/usage`

The proof details live in `docs/PHASE4_OPERATOR_READINESS_PROOF_LOG.md`.
If the API process restarts and local dashboard history disappears, continue from persisted requestIds/session state instead of treating the dashboard reset as proof loss.

## Explicit repo boundaries

- This repo does not prove the live hosting provider, rollout mechanism, or traffic-shifting method.
- This repo does not prove deployed environment variables, secrets, or secret rotation state.
- This repo does not prove whether Firestore rules/indexes are already deployed to every live environment.
- This repo does not prove operator ownership, on-call rotation, or approval workflow.

## Verification standard

- `docs/DOCS_INDEX.md` points here as an active backend runbook.
- The deploy path explicitly separates repo-managed Firestore steps from provider-specific application deploy steps.
- The rollback/hotfix path points back to `docs/INCIDENT_TRACE_RUNBOOK.md` instead of creating a second incident doc.
