# FINAL_PAID_BETA_LAUNCH_PLAN

- Status: CANONICAL
- Owner repo: backend
- Source of truth for: final ordered pre-launch work for Vaiform paid beta readiness across backend and mobile
- Canonical counterparts/source: backend `docs/MOBILE_BACKEND_CONTRACT.md`, backend `docs/MOBILE_HARDENING_PLAN.md`, backend `docs/API_CONTRACT.md`, backend `docs/FINALIZE_CONTROL_ROOM_DASHBOARD.md`, mobile `docs/MOBILE_USED_SURFACES.md`, mobile `docs/MOBILE_RELEASE_RUNBOOK.md`
- Last re-verified against both repos: 2026-04-02

## 1. Purpose

This is the final working plan for getting Vaiform ready for a safe paid beta launch.

It covers only the remaining work that materially affects:

- paid subscription trust
- finalize and billing correctness
- active mobile runtime correctness
- launch-time safety guardrails
- operator visibility and launch confidence

It does not try to solve:

- large-scale throughput planning
- broad repo-wide lint cleanup
- post-beta product expansion
- long-range architecture reshaping

## 2. Launch Standard

Vaiform is ready enough for paid beta only when all of the following are true on the intended launch commit and deployment path:

- active mobile runtime code passes `npm run check:types`
- mobile regression coverage still passes `npm run test:ci`
- mobile CI enforces the same minimum correctness gate that launch depends on
- backend active mobile surfaces still pass the existing contract, observability, response-shape, and security checks
- the legacy blocking `POST /api/story/render` path is removed from the live beta surface or default-disabled
- the paid trust path is empirically closed: billing estimate, finalize admission, worker execution, short-detail readback, usage refresh, and Stripe/webhook settlement have been manually verified on the real launch path
- production-critical paid-beta env/config requirements fail closed instead of letting the app boot into a partially broken paid state
- outward-facing 5xx responses do not leak raw provider or internal exception detail
- the operator can see backlog, worker pressure, readback lag, retry pressure, and billing mismatch signals clearly enough to act during beta
- paid users are not exposed to known avoidable trust-breakers that the repos already prove today

## 3. Current Repo-Verified Blockers

Phase 1 is now complete. The former mobile release-gate blockers below are retained as closure notes; blockers 3+ remain open launch blockers.

### Phase 1 closure 1: active mobile runtime now type-checks cleanly

- Why it mattered: paid beta could not ship with known compile/type failures in active auth, navigation, and creation/edit flows.
- Area: mobile
- Proof: `npm run check:types` now passes after the narrow mobile-only release-gate fixes landed on `client/lib/firebase.ts`, `client/screens/ClipSearchModal.tsx`, `client/navigation/HomeStackNavigator.tsx`, `client/navigation/MainTabNavigator26.tsx`, `client/components/Toast.tsx`, and `server/index.ts`.
- Proof type: check + code

### Phase 1 closure 2: mobile CI now enforces the launch-critical correctness gate

- Why it mattered: even after the type errors were fixed, the repo could regress back into a broken launch state without CI catching it.
- Area: mobile
- Proof: `.github/workflows/mobile-ci.yml` now runs `npm ci`, `npm run check:types`, and `npm run test:ci`, the affected mobile docs no longer describe the lane as test-only, and `jest.config.js` now ignores repo-root `.cache` and `.bun` trees so `test:ci` stays focused on repo-owned tests in affected workspaces.
- Proof type: code

### Blocker 3: paid billing/finalize proof is still not closed

- Why it matters: Vaiform is launching with paid subscriptions on day one, so unresolved billing/finalize trust is a launch blocker, not a later improvement.
- Area: cross-repo
- Proof: backend canonical docs still say the billing cutover is not release-ready until the estimate-proof gate and live Stripe/manual verification are closed, and `docs/FINALIZE_THRESHOLD_REPORT.md` still records a billing mismatch probe.
- Proof type: docs + artifact evidence + externally unproven launch path

### Blocker 4: legacy blocking `/api/story/render` is still live by default

- Why it matters: paid beta should not keep an unused expensive legacy render path mounted when the async finalize path is the intended live contract.
- Area: backend
- Proof: `src/routes/story.routes.js` still mounts `POST /api/story/render` unless `DISABLE_STORY_RENDER_ROUTE=1`, and `server.js` still keeps a 15-minute server timeout because this blocking path exists.
- Proof type: code + canonical contract docs

### Blocker 5: paid-beta env validation is still fail-open for critical services

- Why it matters: launch should not succeed into a partially broken state where Stripe or OpenAI failures are only discovered after real users hit the product.
- Area: backend
- Proof: `src/middleware/envCheck.js` requires Firebase credentials, but treats `OPENAI_API_KEY`, `STRIPE_SECRET_KEY`, and `REPLICATE_API_TOKEN` as optional warnings.
- Proof type: code

### Blocker 6: outward 5xx detail posture is still too permissive

- Why it matters: paid beta should preserve request correlation and logs without leaking raw provider/internal exception messages back to users.
- Area: backend
- Proof: `src/middleware/error.middleware.js` returns `err.code` or `err.name` plus raw `err.message`, and some route-level handlers still forward raw thrown messages.
- Proof type: code

### Blocker 7: operator readiness is implemented in code, but not yet empirically closed for launch

- Why it matters: the dashboard and worker observability are strong enough to use, but paid beta still needs a live rehearsal that proves the operator can see and respond to real launch-path failures.
- Area: cross-repo / operations
- Proof: finalize dashboard access and worker/runtime tests pass, but repo-owned docs still leave live deployment topology, Stripe state, and launch-day operator rehearsal outside repo proof.
- Proof type: code + tests + external unproven state

## 4. Multi-Step Launch Plan

### Phase 1: Release Gate Correctness

- Status: complete
- Phase type: bundled
- Why this phase exists: the active shipped mobile runtime must be clean enough that the launch candidate is not knowingly broken before any paid trust work starts.
- Completed scope:
  - resolved the active mobile TypeScript release-gate failures with narrow, behavior-preserving fixes only
  - made mobile CI enforce the same minimum correctness gate that launch depends on
- Completed work:
  - fixed the active `npm run check:types` failures in the mobile release-gate files already identified by the repo
  - kept the fixes tightly scoped to auth/bootstrap, clip search, navigation typing, toast typing, and the repo-local server typing surface
  - added `npm run check:types` to the mobile CI lane alongside `npm run test:ci`
  - updated the affected mobile docs so the CI lane no longer reads as test-only
  - tightened `vaiform-mobile/jest.config.js` so `test:ci` ignores repo-root `.cache` and `.bun` trees instead of wandering into Bun cache content in affected workspaces
  - reran the relevant release-gate checks and kept the phase mobile-only; no backend runtime behavior changed
  - closed with targeted manual checks of auth/session persistence behavior, storyboard creation, and clip replacement
- Files/docs touched:
  - `vaiform-mobile/.github/workflows/mobile-ci.yml`
  - `vaiform-mobile/jest.config.js`
  - `vaiform-mobile/client/lib/firebase.ts`
  - `vaiform-mobile/client/screens/ClipSearchModal.tsx`
  - `vaiform-mobile/client/navigation/HomeStackNavigator.tsx`
  - `vaiform-mobile/client/navigation/MainTabNavigator26.tsx`
  - `vaiform-mobile/client/components/Toast.tsx`
  - `vaiform-mobile/server/index.ts`
  - `vaiform-mobile/docs/MOBILE_RELEASE_RUNBOOK.md`
  - `vaiform-mobile/docs/DOCS_INDEX.md`
- Phase 1 closeout checks:
  - mobile `npm run check:types` passes
  - mobile `npm run test:ci` passes
  - the CI workflow now runs the same minimum gate as the local release gate
  - targeted manual probes covered auth/session persistence, storyboard creation, and clip replacement
- Stayed out of scope:
  - broad `expo lint` cleanup
  - formatting sweeps
  - unrelated navigation or UI refactors
  - runtime redesign, dependency/package-manager churn, or later launch-phase work

### Phase 2: Paid Trust Path Closure

- Phase type: standalone deep-context phase
- Why this phase exists: paid subscriptions plus async finalize are the core trust path for launch; this is the highest-risk cross-repo surface and needs one focused pass.
- Scope:
  - close billing/finalize proof for the actual launch path
  - fence or remove the legacy blocking render path
  - verify Stripe/webhook/finalize behavior on the real launch configuration
- Exact tasks:
  - re-trace the live paid path end to end across both repos: auth bootstrap, `GET /api/usage`, `POST /api/story/finalize`, `GET /api/story/:sessionId`, `GET /api/shorts/:jobId`, `GET /api/shorts/mine`, Stripe checkout/webhook handling, and mobile recovery/readback behavior
  - default-disable or remove `POST /api/story/render` from the live beta surface
  - run representative manual proof for the paid launch path on the real environment:
    - subscription or paid-entitlement activation path
    - usage visibility before and after finalize
    - accepted finalize -> worker completion -> short detail availability
    - same-attempt recovery after timeout/network interruption
    - Stripe webhook settlement path and duplicate-event safety
  - record estimate-versus-billed evidence and resolve any unexplained mismatch before launch
  - update the canonical backend docs after proof is closed
- Likely files/docs involved:
  - `src/routes/story.routes.js`
  - `src/middleware/idempotency.firestore.js`
  - `src/services/story-finalize.attempts.js`
  - `src/services/story-finalize.runner.js`
  - `src/services/finalize-status.service.js`
  - `src/routes/stripe.webhook.js`
  - `src/controllers/checkout.controller.js`
  - `server.js`
  - `docs/MOBILE_BACKEND_CONTRACT.md`
  - `docs/MOBILE_HARDENING_PLAN.md`
  - `docs/FINALIZE_THRESHOLD_REPORT.md`
  - `docs/FINALIZE_SCALING_RUNBOOK.md`
  - `vaiform-mobile/docs/MOBILE_USED_SURFACES.md` only if caller truth actually changes
- Checks/tests/manual validations before closing:
  - `npm run test:contracts`
  - `npm run test:observability`
  - `npm run check:responses`
  - manual proof log for the real paid launch path with recorded request IDs, attempt IDs, billed usage evidence, and webhook outcome
- Must remain out of scope:
  - scale tuning beyond small beta
  - pricing model changes
  - payment product expansion

### Phase 3: Paid Beta Safety Hardening

- Phase type: bundled
- Why this phase exists: after the main trust path is closed, the remaining pre-launch work should remove obvious fail-open and leak-prone behavior without expanding scope.
- Scope:
  - fail-closed env posture for paid beta
  - safer outward error posture
  - close or explicitly accept the remaining active UX weak spots that can confuse first users
- Exact tasks:
  - tighten env validation so the actual paid-beta deployment refuses to boot without the services the launch path depends on
  - scrub raw provider/internal detail from outward 5xxs while preserving `requestId` and structured logging for debugging
  - review active caption preview failure handling and choose one of two launch-safe outcomes:
    - fix the user-visible failure/diagnostic path before launch, or
    - explicitly mark it as a non-gate accepted risk if storyboard trust is not materially harmed
  - verify the finalize dashboard remains internal-only by default and founder-gated when enabled
- Likely files/docs involved:
  - `src/middleware/envCheck.js`
  - `src/middleware/error.middleware.js`
  - `src/routes/stripe.webhook.js`
  - `src/middleware/finalizeDashboardAccess.js`
  - `src/routes/admin.finalize.routes.js`
  - `vaiform-mobile/client/hooks/useCaptionPreview.ts`
  - `docs/API_CONTRACT.md`
  - `docs/FINALIZE_CONTROL_ROOM_DASHBOARD.md`
- Checks/tests/manual validations before closing:
  - rerun backend `npm run test:contracts`
  - rerun backend `npm run test:observability`
  - rerun mobile `npm run test:ci` if mobile caption-preview behavior changes
  - targeted manual probe of representative 5xx paths to confirm user-facing detail is sanitized and correlated by `requestId`
- Must remain out of scope:
  - token revocation redesign
  - broad auth-system changes
  - full lint cleanup

### Phase 4: Operator Readiness And Launch Monitoring Closure

- Phase type: standalone deep-context phase
- Why this phase exists: the codebase already has meaningful finalize observability, but launch requires an explicit operator posture and one real rehearsal.
- Scope:
  - lock the launch topology and shared-limit posture
  - verify the dashboard, signals, and response playbook on the real environment
  - make launch-day decision thresholds explicit
- Exact tasks:
  - confirm the intended API + finalize-worker topology for beta and verify the actual deployment matches it
  - verify finalize dashboard access, shared pressure visibility, local-process observability, and runbook links on the deployment to be used for beta
  - rehearse at least one full operator run:
    - create story
    - finalize
    - watch queue/backlog/worker signals
    - confirm readback and short availability
    - inspect usage/billing outcome
  - write down exact pause, rollback, and escalation triggers tied to the current dashboard and runbooks
- Likely files/docs involved:
  - `docs/FINALIZE_CONTROL_ROOM_DASHBOARD.md`
  - `docs/FINALIZE_SCALING_RUNBOOK.md`
  - `docs/DEPLOY_ROLLBACK_HOTFIX_RUNBOOK.md`
  - `docs/INCIDENT_TRACE_RUNBOOK.md`
  - deployment env/config outside repo
- Checks/tests/manual validations before closing:
  - confirm backend `npm run test:observability` still passes on the release candidate commit
  - manual dashboard access verification
  - recorded operator rehearsal notes for the intended launch environment
- Must remain out of scope:
  - distributed metrics platform work
  - long-term alerting/history systems beyond what small beta needs now

### Phase 5: Launch Approval Pass

- Phase type: bundled
- Why this phase exists: launch should be a deliberate gate decision, not an accumulation of partially closed tasks.
- Scope:
  - run the final repo checks on the intended launch commit
  - confirm all launch gates are closed
  - record the exact launch posture
- Exact tasks:
  - rerun the final backend and mobile checks listed in Section 5 on the intended launch commit
  - verify that all pre-launch phases are closed without reopening scope
  - confirm the mobile release/runbook prerequisites that are repo-visible
  - record the chosen worker count, shared-limit posture, and operator-on-call expectations for beta day
- Likely files/docs involved:
  - this file
  - `docs/MOBILE_RELEASE_RUNBOOK.md`
  - `docs/MOBILE_BACKEND_CONTRACT.md`
  - `docs/MOBILE_HARDENING_PLAN.md`
  - `docs/FINALIZE_SCALING_RUNBOOK.md`
- Checks/tests/manual validations before closing:
  - backend `npm run test:contracts`
  - backend `npm run test:observability`
  - backend `npm run check:responses`
  - backend `npm run test:security`
  - mobile `npm run check:types`
  - mobile `npm run test:ci`
  - final live smoke on the launch environment
- Must remain out of scope:
  - new hardening ideas discovered after all gates are already green unless they reopen a launch gate

## 5. Launch Gates

### Gate A: Code Correctness Gate

Pass criteria:

- mobile `npm run check:types` passes cleanly
- mobile `npm run test:ci` passes
- mobile CI enforces the minimum launch gate
- no known active-runtime compile/type errors remain in auth, navigation, clip search, finalize, or bootstrap paths

### Gate B: Billing And Finalize Trust Gate

Pass criteria:

- the live beta surface no longer depends on the legacy blocking `/api/story/render` path
- the real launch billing/finalize path has been manually verified end to end
- estimate-versus-billed usage has no unexplained mismatch on representative launch-path samples
- Stripe webhook handling has been validated on the real launch configuration, including duplicate-event safety
- finalize recovery, readback, and usage refresh behavior are confirmed on the real launch path

### Gate C: Beta Safety And Guardrails Gate

Pass criteria:

- production-critical paid-beta env/config validation is fail-closed
- outward 5xx responses no longer leak raw internal/provider detail
- active internal-only surfaces remain internal by default
- the caption-preview failure decision is closed: fixed before launch or explicitly accepted as a documented non-gate risk

### Gate D: Operator Readiness Gate

Pass criteria:

- the intended API + worker topology is chosen and verified in the deployment
- current shared-limit posture is explicitly chosen, not left implicit
- the finalize dashboard is accessible only to the intended operator cohort
- the operator has a documented pause/rollback/escalation posture tied to the current signals
- at least one launch-path rehearsal has been run and recorded

### Gate E: Launch Approval Gate

Pass criteria:

- Gates A through D are all closed on the intended launch commit
- backend and mobile checks are green on that commit
- repo-visible release/runbook prerequisites are satisfied
- any remaining accepted risks are explicitly listed and do not break paid-user trust

## 6. Deferred Until After Beta Starts

These items matter, but they should not block first paid beta unless the corresponding pre-launch phase uncovers new evidence that raises their severity.

- Firebase token revocation enforcement in `requireAuth`
  - why deferred: real gap, but not the top paid-beta launch blocker compared with compile failures, billing proof, and live risky surfaces
- broad mobile lint cleanup
  - why deferred: current `expo lint` output is too broad to use as a paid-beta gate, and most of it is formatting/noise rather than launch-path safety
- broader scale-oriented cleanup for `GET /api/shorts/mine` index fallback and pagination semantics
  - why deferred: the current fallback is not ideal, but a small supervised beta can tolerate it
- deeper observability history/alerting beyond the current control-room and runbooks
  - why deferred: the current repo already has enough signal for supervised beta if operator rehearsal is completed
- non-critical UX polish on library/create affordances and console cleanup
  - why deferred: not core paid-trust blockers

## 7. Suggested Launch Posture

- Topology:
  - one API deployment plus one dedicated finalize worker is the conservative default
  - do not launch with multiple worker processes until the paid trust path is closed and the operator has rehearsed the current dashboard signals
- Shared limits:
  - keep the current shared defaults unless live proof from Phase 2 and Phase 4 justifies a change
  - current repo defaults are shared render limit `3`, shared backlog limit `25`, and overload retry-after `30s`
- Watch during beta:
  - billing mismatch signals
  - queue depth
  - queue oldest age
  - jobs running
  - worker saturation ratio
  - retry-scheduled count
  - short-detail readback lag
  - spikes in `402`, `409 FINALIZE_ALREADY_ACTIVE`, `503 SERVER_BUSY`, and bootstrap failures on `/api/users/ensure` or `/api/usage`
- Pause or rollback if:
  - any billing mismatch repeats or cannot be explained immediately
  - finalize jobs are accepted but fail to settle reliably
  - readback lag or pending availability causes users to lose rendered output trust
  - the worker or dashboard topology in production does not match the rehearsed launch posture
  - auth/bootstrap or usage refresh starts failing for paying users
- Immediate investigation triggers:
  - user charged or subscribed but missing paid entitlement/usage state
  - finalize success without usable short readback
  - repeated `SERVER_BUSY` or retry storms under light beta traffic
  - user reports of “stuck rendering” with no matching operator visibility

## 8. Evidence / References

Primary docs used to build this plan:

- `docs/DOCS_INDEX.md`
- `docs/API_CONTRACT.md`
- `docs/MOBILE_BACKEND_CONTRACT.md`
- `docs/MOBILE_HARDENING_PLAN.md`
- `docs/FINALIZE_THRESHOLD_REPORT.md`
- `docs/FINALIZE_CONTROL_ROOM_DASHBOARD.md`
- `docs/FINALIZE_SCALING_RUNBOOK.md`
- `vaiform-mobile/docs/DOCS_INDEX.md`
- `vaiform-mobile/docs/MOBILE_USED_SURFACES.md`
- `vaiform-mobile/docs/MOBILE_RELEASE_RUNBOOK.md`

Primary backend code/check areas re-verified:

- `src/routes/story.routes.js`
- `src/middleware/requireAuth.js`
- `src/middleware/error.middleware.js`
- `src/middleware/envCheck.js`
- `src/middleware/finalizeDashboardAccess.js`
- `src/routes/admin.finalize.routes.js`
- `src/routes/stripe.webhook.js`
- `src/services/finalize-control.service.js`
- `src/http/respond.js`
- `server.js`
- `test/contracts/phase4a.contract.test.js`
- `test/observability/finalize-admin-dashboard.test.js`
- `test/observability/finalize-worker-runtime.test.js`

Primary mobile code/check areas re-verified:

- `client/api/client.ts`
- `client/contexts/AuthContext.tsx`
- `client/hooks/useCaptionPreview.ts`
- `client/screens/story-editor/useStoryEditorFinalize.ts`
- `client/screens/ClipSearchModal.tsx`
- `client/navigation/HomeStackNavigator.tsx`
- `client/navigation/MainTabNavigator26.tsx`
- `client/lib/firebase.ts`
- `.github/workflows/mobile-ci.yml`
- `client/api/client.test.ts`
- `client/contexts/AuthContext.test.tsx`
- `client/screens/ShortDetailScreen.test.tsx`
- `client/lib/storyFinalizeAttemptStorage.test.ts`

Checks re-verified during this doc-truth pass:

- mobile `npm run check:types` passes
- mobile `npm run test:ci` passes
- backend launch-readiness conclusions continue to match the currently promoted canonical docs, code paths, and previously run contract/observability/security checks from the current audit thread
