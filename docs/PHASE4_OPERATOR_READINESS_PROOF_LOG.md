# PHASE4_OPERATOR_READINESS_PROOF_LOG

- Status: EVIDENCE
- Owner repo: backend
- Scope: Phase 4 operator-readiness closeout proof for the intended paid-beta launch environment
- Rehearsal date: 2026-04-04

## Repo Checks Re-run

- `npm run test:observability` - pass
- `npm run test:contracts` - pass
- `npm run test:security` - pass
- `npm run check:responses` - pass

## Intended Launch Environment Facts

- Public API entrypoint verified from repo config: `https://vaiform.com/api/*`
- Backend origin used for operator proof: `https://17e0d1d1-e327-483d-b1ea-c41bea08fb59-00-1ef93t84nlhq6.janeway.replit.dev`
- Backend health after restart: `GET /health` `200`, requestId `fd4b063a-1711-437b-ac90-1888feb7d15a`
- Provider/runtime clue available from live headers: `Replit-Cluster: janeway`
- Dashboard payload environment: `development`, requestId `dfb5d8ce-3922-4da7-93b9-0083084d64c4`
- Exact deployed commit SHA was not externally observable from repo or runtime surfaces during this pass.

## Topology / Limit Proof

- Repo truth still defines separate API and finalize-worker entrypoints via `server.js` and `story-finalize.worker.js`.
- Live rehearsal proved async finalize was accepted by the API and later settled through worker processing:
  - finalize accepted `202`, requestId `ae65d23e-684a-48fe-ada9-0fa5629be791`
  - recovery later returned `renderRecovery.state = done`, requestId `82a180d0-d839-4ad2-a8ef-12841d97bb8b`
- Live dashboard local panel reported `workersActive = null` on the API-serving process, so the page-serving API process was not presenting itself as the finalize worker runtime.
- Exact live worker count and worker deployment identity were not externally observable from repo/runtime surfaces during this pass.
- Effective shared limits verified live from dashboard payload:
  - render limit `3`
  - backlog limit `25`
  - overload retry-after `30s`
  - OpenAI shared slots `2`
  - story-search shared slots `2`
  - TTS shared slots `1`

## Dashboard Verification

- `GET /api/admin/finalize/data` unauthenticated returned `401 AUTH_REQUIRED`
  - `https://vaiform.com/api/admin/finalize/data` requestId `cccb2e59-bc73-497d-b418-c6680b873d74`
  - backend origin requestId `25c74d91-c26f-4d1f-88a1-4bc29f76accc`
- Founder-authenticated dashboard data returned `200`
  - pre-restart requestId `fa3737c5-d7f9-454c-8d17-4238777f6243`
  - post-restart requestId `dfb5d8ce-3922-4da7-93b9-0083084d64c4`
- No live `403` probe was forced because no clean non-allowlisted/unverified test user was provisioned on the target environment; automated coverage remains the source of truth for `403`.
- Verified live dashboard operator signals:
  - shared verdict `healthy`
  - queue depth `0`
  - retry-scheduled `0`
  - shared backlog `0/25`
  - shared render leases `0/3`
  - provider cooldown count `0`
  - local panel remained explicitly secondary
- Verified live dashboard runbook links:
  - `Scaling Runbook`
  - `Threshold Report`
  - `Incident Trace Runbook`
  - `Alert Artifacts`
- No dashboard code change was justified. The existing linked runbooks were sufficient for the supervised operator flow.

## Operator Rehearsal

### Bootstrap and Story Creation

- `POST /api/users/ensure` `200`, requestId `b48eae89-1349-4ab5-b889-f0b317e1cd6a`
- `GET /api/usage` before render `200`, requestId `ea4e7341-897d-42e0-84f2-7d770a74d6e6`
  - `cycleUsedSec = 54`
  - `availableSec = 1746`
- `POST /api/story/start` `200`, requestId `72ab8d4c-70a1-4db1-a2de-df171ce17cd8`
  - `sessionId = story-26082d38-9c4c-4b56-98a7-1b9ef04e6b84`
- `POST /api/story/generate` `200`, requestId `7999050f-687a-44ab-8059-0a952c6207c3`
- `POST /api/story/plan` `200`, requestId `22198133-4fc3-47f1-8810-b8bfd99bf3c1`
- `POST /api/story/search` `200`, requestId `26d122e3-40b8-4459-b9e1-9b1b691ff5fd`
- `GET /api/story/:sessionId` after search `200`, requestId `d58a9e82-4228-4b0e-a6dd-ac23a2b7424a`
  - selected clip count `8`

### Finalize and Recovery

- Dashboard before finalize `200`, requestId `ed88d214-0f42-43af-9f8a-aed7336411ca`
  - verdict `healthy`
  - render limit `3`
  - backlog limit `25`
- `POST /api/story/finalize` `202`, requestId `ae65d23e-684a-48fe-ada9-0fa5629be791`
  - `attemptId = phase4-58ef5c8d-1b77-4f23-afd4-bf84a898ac6f`
  - `renderRecovery.state = pending`
- Dashboard immediately after finalize `200`, requestId `7f1066eb-d4bb-4629-82a8-b7e8c0b6d8cd`
  - verdict remained `healthy`
- Persisted recovery evidence after restart:
  - `GET /api/story/:sessionId` `200`, requestId `82a180d0-d839-4ad2-a8ef-12841d97bb8b`
  - `renderRecovery.state = done`
  - `shortId = story-mnky4ciu`
  - `startedAt = 2026-04-04T23:08:55.784Z`
  - `finishedAt = 2026-04-04T23:10:39.875Z`
- Post-restart confirmation:
  - `GET /api/story/:sessionId` `200`, requestId `da0dc51e-d195-44ed-a02d-f08470550e99`
  - status `rendered`
  - `finalVideo.jobId = story-mnky4ciu`
  - `finalVideo.durationSec = 36.81`

### Readback and Usage

- `GET /api/shorts/story-mnky4ciu` `200`, requestId `202377eb-1b80-4142-af8d-ca3f16764a69`
  - `videoUrl` present
  - `coverImageUrl` present
  - readback source: direct short detail
- `/api/shorts/mine?limit=50` fallback was not needed in this rehearsal.
- `GET /api/usage` after render `200`, requestId `90430aae-58c7-49c7-815e-713afcb0a672`
  - `cycleUsedSec = 91`
  - `availableSec = 1709`
  - usage delta from pre-render snapshot: `+37 sec`
- Usage delta matched rendered duration rounding (`36.81 sec` video => `37 sec` usage delta).
- The recovered session projection did not expose `billing.billedSec`, but the dashboard local mismatch metric remained `0` after restart and usage settled correctly.

## Post-Restart Operator Notes

- The backend was restarted after the initial rehearsal and earlier transient logs were no longer available.
- Shared dashboard truth, persisted session state, persisted short detail, and usage settlement remained available after restart.
- The local dashboard panel repopulated only with post-restart local events. Treat that panel as restart-sensitive operator context, not durable history.

## Operator Decision Posture Confirmed

- Pause trigger:
  - any new billing mismatch signal that cannot be explained immediately
  - finalize accepted but not settling reliably
  - short readback trust loss after successful finalize
- Rollback trigger:
  - launch-day deployment/runtime posture materially differs from the rehearsed API-plus-worker behavior
  - auth/bootstrap or usage refresh starts failing for paying users
- Escalation trigger:
  - repeated `SERVER_BUSY` / retry storms under light traffic
  - user reports of stuck rendering without matching operator visibility
  - finalize success without usable short readback

## Blocker Assessment

- No new code blind spot was proven in this pass.
- No dashboard enhancement was justified.
- Residual note: exact worker count and deployed commit/provider rollout identity were not externally observable from repo/runtime surfaces and should be copied into launch notes outside the repo if the hosting console exposes them.
