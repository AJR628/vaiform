# INCIDENT_TRACE_RUNBOOK

Last verified against repo code: 2026-03-23.

Purpose: manual trace workflow for the Cross-Repo Phase 3 observability scope only.

## Scope

- Failed finalize / idempotent replay / recovery trace
- Missing short-detail / retry / fallback trace

## Known boundaries

- Backend structured logs are stdout-only.
- Mobile diagnostics are in-memory only and are cleared on app restart.
- Cross-repo execution order still lives in `docs/CROSS_REPO_PRODUCTION_HARDENING_PLAN.md`.

## Correlation keys

Capture as many of these as the incident provides:

- `requestId`
- `sessionId`
- `attemptId` (`X-Idempotency-Key` on finalize)
- `shortId`
- route
- status / code

## Finalize / Replay / Recovery Trace

1. Start on mobile:
- Check the in-memory diagnostics buffer for `/api/story/finalize` and `/api/story/:sessionId`.
- Capture `requestId`, `status`, `code`, `sessionId`, and `attemptId`.
- Expected mobile context sources:
  - `client/api/client.ts`
  - `client/screens/StoryEditorScreen.tsx`

2. Correlate the backend finalize request:
- Search stdout logs for the same `requestId`.
- Expected events:
  - `story.finalize.request`
  - `story.finalize.accepted`
  - `story.finalize.replay_pending`
  - `story.finalize.conflict_active_attempt`
  - `story.finalize.replay_completed`
  - `story.finalize.replay_failed`
  - `story.finalize.failed`
  - `request.error`

3. Correlate async attempt lifecycle:
- Filter on the same `attemptId` and `sessionId`.
- Expected events:
  - `story.finalize.idempotency.enqueued`
  - `story.finalize.idempotency.settled`
  - `story.finalize.attempt.released`
  - `story.finalize.idempotency.prepare_failed`

4. Correlate backend recovery and runner state:
- Filter on the same `sessionId` and `attemptId`.
- Expected events:
  - `story.finalize.service.start`
  - `story.finalize.recovery_pending_persisted`
  - `story.finalize.service.completed`
  - `story.finalize.service.failed`
  - `story.finalize.recovery_failure_persist_failed`
  - `story.finalize.runner.recovery_failure_persist_failed`
  - `story.finalize.runner.task_failed`
  - `story.finalize.runner.reaper_failed`
  - `story.recovery.poll`

5. Interpret common outcomes:
- `202` with additive `finalize.state: "pending"` means the attempt was accepted or same-key replay is still pending.
- `FINALIZE_ALREADY_ACTIVE` with additive `finalize.attemptId` means a different key collided with the already-active same-session attempt.
- `story.finalize.replay_completed` with a `shortId` means the prior attempt already settled and same-key replay returned the existing result.
- `story.finalize.attempt.released` or session `renderRecovery.failed` means the attempt reached terminal failure and reserved usage was released.
- `story.finalize.recovery_failure_persist_failed` means the render failure happened, but the session-level failure marker could not be persisted. Treat this as a partial observability failure and inspect surrounding `story.finalize.service.failed` / `request.error` logs.
- `IDEMPOTENT_IN_PROGRESS` is now legacy compatibility guidance for older blocking finalize callers; it is not the primary live mobile async finalize path.

## Missing Short Detail / Retry / Fallback Trace

1. Start on mobile:
- Check the in-memory diagnostics buffer for `/api/shorts/:jobId` and `/api/shorts/mine?limit=50`.
- Capture `requestId`, `shortId`, retry counters, and fallback stage markers.
- Expected mobile-only diagnostic codes:
  - `DETAIL_PENDING_RETRY`
  - `DETAIL_RETRY_TIMEOUT`
  - `LIBRARY_FALLBACK_HIT`
  - `LIBRARY_FALLBACK_MISS`

2. Correlate the backend detail request:
- Search stdout logs for the same `requestId` or `shortId`.
- Expected events:
  - `shorts.detail.meta_hit`
  - `shorts.detail.storage_hit`
  - `shorts.detail.not_found`
  - `shorts.detail.failed`

3. Interpret common outcomes:
- `shorts.detail.not_found` with mobile `404 NOT_FOUND` means the bridge asset was still unavailable when detail was requested.
- `LIBRARY_FALLBACK_HIT` means detail was still unavailable but list fallback found the ready short first.
- `DETAIL_RETRY_TIMEOUT` means the mobile retry window exhausted without a terminal backend failure; treat it as pending availability unless backend logs show a real `shorts.detail.failed`.

## Usage / Billing State Triage

1. Start on mobile:
- Capture the `/api/usage` `requestId`, `status`, and `code`.
- Note whether the request happened during auth bootstrap or an explicit refresh.
- Expected mobile context sources:
  - `client/contexts/AuthContext.tsx`
  - `client/api/client.ts`
  - `client/screens/SettingsScreen.tsx`

2. Correlate the backend usage request:
- Search stdout logs for the same `requestId`.
- Expected error events:
  - `auth.bootstrap.usage.failed`
  - `request.error`

3. Inspect the canonical backend usage owner:
- `src/routes/usage.routes.js` owns the authenticated `/api/usage` route.
- `src/controllers/usage.controller.js` returns the canonical success/failure envelope for the route.
- `src/services/usage.service.js` builds the response from canonical `plan`, `membership`, and `usage` state, including `availableSec = cycleIncludedSec - cycleUsedSec - cycleReservedSec`.

4. Interpret common outcomes:
- A failed `/api/usage` call during auth bootstrap signs the user out instead of letting the app enter a half-ready state.
- Lower-than-expected `availableSec` may be explained by an active finalize reservation. Before treating it as a billing drift, trace the same user's recent finalize attempt and confirm whether usage is still reserved or has already settled/released.
- After a terminal finalize success, mobile may also surface additive `data.billing.billedSec`. After a terminal finalize failure or reaped failure, reserved usage should release once. If `/api/usage` still looks wrong after a terminal finalize state, inspect the related finalize attempt trace and the canonical backend usage state together.
- This runbook proves the current read path and its correlation points. It does not prove webhook delivery, store billing state, or other external commerce-provider events.

## Redaction Checklist

When inspecting backend stdout logs, verify the canonical logger path is not emitting:

- raw `Authorization` values
- raw cookies
- API keys or secrets
- raw provider payloads
- full storage/public URLs
- unsafe raw prompt/caption/body blobs

If any of the above appear in logs from the canonical logger path, the incident trace is not Phase 3 compliant and should be fixed before widening observability scope.
