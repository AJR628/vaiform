# TIME_BASED_RENDER_USAGE_MIGRATION_PLAN

## 1. Purpose

This document is the canonical implementation guide for replacing Vaiform's credit-based billing model with a time-based render-usage model.

Target user-facing model:
- Users receive render-time allowance per billing cycle.
- User-facing language is `render time`, `minutes left`, `seconds left`, and `estimated usage`.
- Internal billing unit is integer seconds.
- Billing is based on final rendered output duration only.

Explicitly out of scope:
- Billing wall-clock app time.
- Billing queue wait time.
- Billing raw server render time.
- Billing retry time.
- Billing network delay time.
- Preserving credits as an active billing concept.
- Runtime implementation in this pass.

Hard-cutover policy:
- There are no live users.
- Credits are dead legacy data.
- No credit-balance migration is required.
- No long-lived compatibility bridge is required.
- Any temporary bridge used during implementation must exist for one phase maximum and be removed immediately after the replacement surface lands.
- Phases 1, 2, and 3 are one continuous cutover track on a single branch. They ship one phase at a time with separate verification gates, but the branch is not expected to be release-coherent until all three phases are landed and verified together.

## 2. Audited Current State

Credits are currently wired into the product as a real billing system, not a copy artifact.

Evidence-backed current state:
- Provisioning defaults write `credits: 100` and related credit-native fields into `users/{uid}` through `src/services/credit.service.js`.
- `GET /api/credits` is a mounted live backend contract through `src/app.js`, `src/routes/credits.routes.js`, and `src/controllers/credits.controller.js`.
- Finalize currently reserves and refunds credits through `src/middleware/idempotency.firestore.js`.
- Render gating still checks credit balance in `src/middleware/planGuards.js` and `src/routes/story.routes.js`.
- Paid/pro entitlement heuristics still infer entitlement from `credits > 0` or related legacy fields in `src/middleware/planGuards.js`, `src/services/user.service.js`, and `src/controllers/limits.controller.js`.
- Stripe plan checkout, Stripe pack checkout, and renewal webhooks still grant credits through `src/controllers/checkout.controller.js` and `src/routes/stripe.webhook.js`.
- Mobile still reads credits in `client/api/client.ts`, `client/contexts/AuthContext.tsx`, `client/screens/StoryEditorScreen.tsx`, and `client/screens/SettingsScreen.tsx`.
- Web still sells and displays credits in `web/public/pricing.html`, `web/public/buy-credits.html`, `web/public/js/pricing.js`, `web/public/js/buy-credits.js`, `web/public/js/credits-ui.js`, `web/public/js/my-shorts.js`, and `web/public/js/success.js`.
- Short detail still exposes a legacy credit-shaped field from `meta.json` in `src/controllers/shorts.controller.js`.
- Canonical docs and smoke scripts still describe `/api/credits` and fixed credit cost in `docs/MOBILE_BACKEND_CONTRACT.md`, `docs/LEGACY_WEB_SURFACES.md`, `scripts/smoke.mjs`, and the mobile repo docs/spec.

Why this is a model refactor, not a rename:
- Credits currently drive balance, gating, reservation, refund, purchase grants, entitlement inference, UI copy, and tests.
- Replacing this safely requires deleting the credit model and replacing it with a distinct time model, not renaming credit fields.

## 3. Locked Decisions

### Repo-constrained decisions
- Backend owns billing truth.
- Mobile and web consume server-owned usage data and do not derive billing math locally.
- Canonical entitlement state remains on `users/{uid}`.
- Canonical usage state lives at `users/{uid}.usage`.
- Canonical final settlement source is `session.finalVideo.durationSec`, which is already persisted during finalize.
- Canonical estimate is additive server-owned `storySession.billingEstimate`.
- Finalize must preserve current safety properties: reserve before render, replay idempotently, release on failure, settle once.

### Locked migration decisions
- Billing unit is integer seconds.
- Active billing API is `GET /api/usage`.
- `/api/credits` is removed during the cutover; it is not repurposed to mean seconds.
- Credits are not migrated, preserved, or translated into a live compatibility balance.
- Entitlements and usage are separate truths.
- `plan` and `membership.*` are entitlement truth.
- `usage.*` is billing/consumption truth.
- Credit-derived paid/pro heuristics are deleted, not retained.

### Locked product decisions
- Launch catalog is subscription-only monthly time allowance:
  - Creator: `600` sec per cycle.
  - Pro: `1800` sec per cycle.
- No top-ups at launch.
- No free included time at launch.
- Billed seconds are `Math.ceil(finalVideo.durationSec)`.
- Estimate reservation is treated as a conservative upper bound for supported stories.
- A supported story must satisfy `billedSec <= reservedSec`.
- There is no post-render overdraft, negative-balance, or retroactive delta-charge branch in the first cut.
- If top-ups are ever reintroduced later, that is a new feature, not part of this migration.

## 4. Open Decisions

- None.

## 5. Canonical Target Architecture

### Entitlement model

Canonical entitlement fields on `users/{uid}`:

```json
{
  "plan": "free | creator | pro",
  "membership": {
    "status": "inactive | active | canceled | past_due | trialing",
    "kind": "free | subscription",
    "billingCadence": "none | monthly",
    "startedAt": "Timestamp | null",
    "expiresAt": "Timestamp | null",
    "canceledAt": "Timestamp | null"
  }
}
```

Rules:
- `free` means no included render time.
- `creator` and `pro` map to cycle allowance only through backend-owned usage state.
- Root `credits`, `isMember`, and `subscriptionStatus` are legacy-only and removed by the end of the cutover.

### Usage model

Canonical usage fields at `users/{uid}.usage`:

```json
{
  "version": 1,
  "billingUnit": "sec",
  "periodStartAt": "Timestamp | null",
  "periodEndAt": "Timestamp | null",
  "cycleIncludedSec": 0,
  "cycleUsedSec": 0,
  "cycleReservedSec": 0,
  "updatedAt": "Timestamp"
}
```

Derived server-side only:

```text
availableSec = max(0, cycleIncludedSec - cycleUsedSec - cycleReservedSec)
```

Rules:
- `availableSec` is computed, returned, and never stored as canonical source-of-truth.
- No top-up fields exist in the launch cutover schema.

### Session estimate model

Additive server-owned session field:

```json
"billingEstimate": {
  "estimatedSec": 0,
  "source": "caption_timeline | shot_durations | reading_duration",
  "computedAt": "Timestamp"
}
```

Locked source order:
1. Caption timeline total, if caption timings exist.
2. Sum of shot `durationSec`, if shots exist.
3. Reading-duration fallback.

Rules:
- Estimate is backend-owned only.
- Estimate is a conservative reservation target, not client-derived math.
- Phase verification must prove the estimate is not below billed duration for supported flows.

### Finalize reserve/settle model

Canonical idempotency reservation record shape:

```json
{
  "state": "pending | done",
  "sessionId": "string",
  "usageReservation": {
    "estimatedSec": 0,
    "reservedSec": 0
  },
  "billingSettlement": {
    "billedSec": 0,
    "settledAt": "Timestamp"
  },
  "shortId": "string | null"
}
```

Locked finalize semantics:
1. Load session and `billingEstimate`.
2. Validate `availableSec >= estimatedSec`.
3. In one transaction:
   - create pending idempotency doc,
   - increment `cycleReservedSec` by `estimatedSec`,
   - never reserve twice for the same idempotency key.
4. Render.
5. Read `session.finalVideo.durationSec`.
6. Compute `billedSec = Math.ceil(session.finalVideo.durationSec)`.
7. Assert `billedSec <= reservedSec`.
8. In one settlement transaction:
   - decrement `cycleReservedSec` by `reservedSec`,
   - increment `cycleUsedSec` by `billedSec`,
   - persist `billingSettlement`,
   - persist `shortId`,
   - release any reserved-but-unused seconds implicitly by removing the full reservation and only adding `billedSec` to used.
9. On terminal failure:
   - decrement `cycleReservedSec` by `reservedSec`,
   - delete or close the pending reservation doc,
   - return failure with no permanent charge.
10. On replay:
   - return the settled result without any second reservation or second charge.

Unsupported in the first cut:
- Charging more than reserved after render.
- Negative balances.
- Using leftover credits as fallback usage.

### Short-level billing metadata

Canonical additive short field:

```json
"billing": {
  "estimatedSec": 0,
  "billedSec": 0,
  "settledAt": "Timestamp",
  "source": "finalVideo.durationSec"
}
```

Rules:
- `durationSec` remains media/output truth.
- `billing.billedSec` becomes billing truth.
- Legacy `credits` metadata is deleted from active contract surfaces.

### Canonical API surfaces

`GET /api/usage`

```json
{
  "success": true,
  "data": {
    "plan": "free | creator | pro",
    "membership": {
      "status": "inactive | active | canceled | past_due | trialing",
      "kind": "free | subscription",
      "billingCadence": "none | monthly",
      "startedAt": "ISO-8601 | null",
      "expiresAt": "ISO-8601 | null",
      "canceledAt": "ISO-8601 | null"
    },
    "usage": {
      "billingUnit": "sec",
      "periodStartAt": "ISO-8601 | null",
      "periodEndAt": "ISO-8601 | null",
      "cycleIncludedSec": 0,
      "cycleUsedSec": 0,
      "cycleReservedSec": 0,
      "availableSec": 0
    }
  },
  "requestId": "string"
}
```

Story/session contract additions:
- Add `billingEstimate` to active session payloads.
- Add `billing` to finalize success payloads after settlement.

Finalize success contract:

```json
{
  "success": true,
  "data": {
    "id": "sessionId",
    "sessionId": "sessionId",
    "renderRecovery": {},
    "finalVideo": {},
    "billingEstimate": {
      "estimatedSec": 0,
      "source": "caption_timeline | shot_durations | reading_duration",
      "computedAt": "ISO-8601"
    },
    "billing": {
      "billedSec": 0,
      "settledAt": "ISO-8601"
    }
  },
  "shortId": "jobId",
  "requestId": "string"
}
```

Short detail/list contract additions:
- Detail adds `billing.estimatedSec`, `billing.billedSec`, `billing.settledAt`.
- List items add `billing.billedSec`.

## 6. Hard-Cutover Phase Plan

### Phase 1 — Backend time-model foundation
Tag: `backend-only`

Goal:
- Add `users/{uid}.usage`.
- Add `GET /api/usage`.
- Add session `billingEstimate`.
- Stop provisioning new users with canonical credit semantics.

Why now:
- All later work depends on canonical backend time truth.
- Current repos already centralize entitlement/billing state on `users/{uid}`.
- Phase 1 is intentionally additive and backend-only. By itself it does not need to preserve a fully coherent end-to-end released runtime, because Phases 1 through 3 are one continuous cutover track on the same branch.

Touches:
- backend usage service/controller/route.
- provisioning helper.
- story/session service and routes.
- backend contract docs.

Temporary bridge:
- None required in the design.
- Existing credit fields may still physically exist in code during implementation, but they are no longer treated as canonical once this phase lands.

Verification gates:
- New users provision with `plan`, `membership`, and `usage`; no canonical credit balance is required.
- `GET /api/usage` returns the locked shape.
- Session payloads return `billingEstimate`.
- No new backend path depends on `credits` for canonical logic.
- Phase 1 docs explicitly state that current mobile/web callers are not yet migrated and that branch-level release coherence is deferred until Phases 1 through 3 complete.

Docs:
- `docs/TIME_BASED_RENDER_USAGE_MIGRATION_PLAN.md`
- `docs/MOBILE_BACKEND_CONTRACT.md`
- `docs/API_CONTRACT.md`
- `docs/MOBILE_HARDENING_PLAN.md`

### Phase 2 — Backend finalize/time-billing cutover
Tag: `backend-only`

Goal:
- Replace credit reservation/refund with seconds reservation/settlement.
- Replace backend render gating with time-based availability.
- Remove credit-derived entitlement heuristics from backend runtime paths.

Why now:
- Backend billing truth must be coherent before clients switch over.
- No live users means the backend can hard-switch without preserving credit semantics.

Touches:
- finalize idempotency middleware.
- story finalize route/service.
- plan guard and entitlement helper code.
- short billing metadata write path.

Temporary bridge:
- None in the target design.
- A one-phase implementation stub is allowed only if needed to keep a branch coherent while callers are updated.

Verification gates:
- `billedSec = Math.ceil(finalVideo.durationSec)`.
- Same idempotency key cannot double-bill.
- Failure releases reserved seconds.
- Successful finalize persists short `billing`.
- Backend no longer debits credits or throws `INSUFFICIENT_CREDITS`.
- Backend no longer infers paid/pro from credit balance.
- Phase 2 is blocked from going live until representative supported stories prove `estimatedSec >= billedSec`, or a documented server-side safety buffer is added and verified when the raw estimate is not conservative enough.

Docs:
- `docs/TIME_BASED_RENDER_USAGE_MIGRATION_PLAN.md`
- `docs/MOBILE_BACKEND_CONTRACT.md`
- `docs/API_CONTRACT.md`
- `docs/MOBILE_HARDENING_PLAN.md`

### Phase 3 — Caller migration and active contract cutover
Tag: `backend + mobile`

Goal:
- Move active callers from credit surfaces to time surfaces.
- Remove `/api/credits` from active contract usage.
- Replace mobile billing copy and settings/render balance UX.

Why now:
- After backend truth is coherent, callers can switch once, directly, without hybrid logic.
- Current mobile caller concentration is small and well-traced.

Touches:
- mobile API client and auth context.
- mobile settings and story editor screens.
- any active web surface that still reads current balance from backend.
- `/api/credits` route removal or immediate deprecation.

Temporary bridge:
- At most one short deprecation stub for `/api/credits` returning explicit removal error if implementation sequencing needs it.
- That stub must be removed before this phase is marked complete.

Verification gates:
- Mobile reads `GET /api/usage`, not `/api/credits`.
- Mobile displays `minutes left`, `seconds left`, and `estimated usage`.
- Mobile render gating uses server-owned `billingEstimate` and `availableSec`.
- No active caller displays or reads `credits`.
- `/api/credits` is removed or explicitly dead.

Docs:
- `docs/TIME_BASED_RENDER_USAGE_MIGRATION_PLAN.md`
- `docs/MOBILE_BACKEND_CONTRACT.md`
- mobile `docs/MOBILE_USED_SURFACES.md`
- mobile `docs/MOBILE_BACKEND_CONTRACT.md`
- mobile `docs/DOCS_INDEX.md`

### Phase 4 — Stripe/catalog hard rewrite
Tag: `backend + web/Stripe`

Goal:
- Rewrite pricing/catalog/billing around monthly render time only.
- Remove credit-pack checkout routes and credit-pack webhook handling.
- Update web pricing/success/billing copy to time-based language.

Why now:
- Runtime billing model and active caller contract are already cut over.
- No live users means the catalog can be replaced directly rather than migrated.

Touches:
- checkout controller/routes/schema.
- Stripe webhook.
- pricing and success pages.
- buy-credits surface removal or repurpose.
- legacy web balance display code.

Temporary bridge:
- None.

Verification gates:
- `POST /api/checkout/start` no longer accepts credit semantics.
- Credit-pack routes are removed or dead.
- Webhook no longer grants credits.
- Web pricing no longer mentions credits.
- Web no longer reads Firestore `users/{uid}.credits` directly.

Docs:
- `docs/TIME_BASED_RENDER_USAGE_MIGRATION_PLAN.md`
- `docs/MOBILE_BACKEND_CONTRACT.md`
- `docs/LEGACY_WEB_SURFACES.md`
- `docs/API_CONTRACT.md`
- `docs/DOCS_INDEX.md`

### Phase 5 — Credit removal and cleanup
Tag: `cleanup/removal`

Goal:
- Delete remaining credit-native code, docs, tests, and stale compatibility fields.

Why now:
- By this point the replacement model is fully active.
- Remaining credit references are drift risk only.

Touches:
- credit service code that no longer belongs to launch model.
- dead routes and helpers.
- stale smoke/tests/spec artifacts.
- short-detail legacy `credits`.
- dead web credit assets.

Temporary bridge:
- None.

Verification gates:
- No active code path reads, writes, grants, reserves, refunds, infers from, or displays credits.
- No canonical doc describes `/api/credits` or credit cost.
- Smoke tests assert `/api/usage`, not `/api/credits`.
- Spec/history docs are either updated or clearly marked historical.

Docs:
- `docs/TIME_BASED_RENDER_USAGE_MIGRATION_PLAN.md`
- `docs/MOBILE_BACKEND_CONTRACT.md`
- `docs/MOBILE_HARDENING_PLAN.md`
- `docs/LEGACY_WEB_SURFACES.md`
- `docs/API_CONTRACT.md`
- mobile `docs/MOBILE_USED_SURFACES.md`
- mobile spec/history docs

## 7. Contract Deltas

- Add `GET /api/usage` as the only active billing balance surface.
- Remove `GET /api/credits` during caller migration. Optional temporary `410 CREDITS_REMOVED` stub is allowed for one implementation phase maximum.
- Add `billingEstimate` to active story/session payloads.
- Add settled `billing` fields to finalize success payloads.
- Add `billing` fields to short detail/list payloads.
- Remove credit-native balance fields from mobile profile/settings usage.
- Remove credit-native pricing/buy/success payload assumptions from web.
- Rewrite `POST /api/checkout/start` around monthly time plans only.
- Remove credit-pack checkout endpoints and webhook grant semantics.

## 8. Anti-Drift Rules

- Mobile repo owns caller-truth: exact screens, hooks, contexts, payloads, and fields actively read.
- Backend repo owns billing contract truth: canonical response shapes, field names, guarantees, migration status, and legacy classification.
- Every phase that changes runtime contract must update backend contract docs in the same change.
- Every phase that changes active mobile callers must update mobile caller-truth docs in the same change.
- Exact field names in this plan are canonical; implementation must either use them exactly or update this plan in the same change.
- Temporary bridges are allowed only when named explicitly in the phase plan, and each bridge must record its removal phase.
- Do not preserve credit math behind time-based copy.
- Do not infer entitlement from usage balance.
- Do not infer usage from entitlement fields.

## 9. Verification Checklist

### Global
- Search both repos for active `credits` reads, writes, grants, reservations, refunds, UI strings, tests, and docs after every phase.
- Verify `GET /api/usage` shape matches this plan exactly.
- Verify finalize replay, failure release, and settlement remain deterministic.
- Verify docs update in the same phase as code changes.
- Treat Phases 1 through 3 as one release track. Do not call the cutover releasable until all three are landed and verified together.

### Phase-specific
- Phase 1: user docs carry canonical `usage`; session payloads carry `billingEstimate`.
- Phase 2: no backend billing path depends on credits; finalize settles in seconds only; estimate-proof verification demonstrates `estimatedSec >= billedSec` on representative supported stories or records the server-side safety buffer that makes that true.
- Phase 3: no active caller uses `/api/credits`; mobile shows time-based language only.
- Phase 4: no checkout or webhook path grants credits; web catalog is time-only.
- Phase 5: no active code, docs, or tests encode credit semantics.

### Removal criteria
- `/api/credits` is absent or dead.
- `RENDER_CREDIT_COST` is absent from active runtime.
- No active entitlement heuristic reads `credits`.
- No active UI says `credits`.
- No active short response returns `credits`.
- Smoke/tests/specs no longer assert credit balance or credit cost.

## 10. Status Ledger

| Phase | Status |
| --- | --- |
| Phase 1 — Backend time-model foundation | Planned |
| Phase 2 — Backend finalize/time-billing cutover | Planned |
| Phase 3 — Caller migration and active contract cutover | Planned |
| Phase 4 — Stripe/catalog hard rewrite | Planned |
| Phase 5 — Credit removal and cleanup | Planned |
