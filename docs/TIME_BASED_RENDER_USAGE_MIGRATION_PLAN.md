# TIME_BASED_RENDER_USAGE_MIGRATION_PLAN

## 1. Purpose

This document is the canonical implementation guide for replacing Vaiform's credit-based billing model with a time-based render-usage model.

Target user-facing model:
- Users receive render-time allowance per billing cycle.
- User-facing language is `render time`, `minutes left`, `seconds left`, and `estimated usage`.
- Internal authoritative billing unit is integer milliseconds; public contract fields remain second-based decimals.
- Billing is based on two additive operations on one unified ledger:
  - voice sync charges `50%` of the narration duration generated in that sync operation
  - final render charges `50%` of the final rendered output duration

Explicitly out of scope:
- Billing wall-clock app time.
- Billing queue wait time.
- Billing raw server render time.
- Billing retry time.
- Billing network delay time.
- Preserving credits as an active billing concept.
- Runtime changes outside the currently landed phases recorded in the status ledger below.

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
- Phase 1, Phase 2, and Phase 3 runtime billing/caller cutover work is landed in code.
- Phase 4 Stripe/catalog rewrite is landed in code (`/api/checkout/start` monthly plans only, webhook entitlement/usage sync, pricing/success time-native web flows).
- Phase 5 runtime cleanup is now landed:
  - `/api/credits` is unmounted and removed (`src/app.js`, deleted `src/routes/credits.routes.js`, deleted `src/controllers/credits.controller.js`).
  - legacy checkout dead bridges `/api/checkout/session` and `/api/checkout/subscription` are removed from runtime (`src/routes/checkout.routes.js`, `src/controllers/checkout.controller.js`).
  - legacy compatibility fields `isMember` and `subscriptionStatus` are removed from active billing/runtime paths (`src/services/usage.service.js`, `src/routes/stripe.webhook.js`, `src/middleware/idempotency.firestore.js`).
  - credit-derived heuristics are removed from active backend runtime (`src/middleware/planGuards.js`, `src/controllers/limits.controller.js`, `src/services/user.service.js`).
  - short detail no longer returns a credit-shaped payload field (`src/controllers/shorts.controller.js`).
  - active provisioning no longer depends on `src/services/credit.service.js`; neutral user-doc provisioning is now owned by `src/services/user-doc.service.js`, and `src/services/credit.service.js` is removed.
  - active smoke coverage now validates `/api/usage` instead of `/api/credits` (`scripts/smoke.mjs`).
- Mobile active billing callers continue to use canonical usage surfaces (`client/api/client.ts`, `client/contexts/AuthContext.tsx`, `client/screens/StoryEditorScreen.tsx`, `client/screens/SettingsScreen.tsx`).
- Manual verification gates remain open: representative estimate-proof closure and live Stripe/manual end-to-end verification are not closed by this cleanup phase.

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
- Public contract unit remains seconds, but authoritative backend math uses integer milliseconds.
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
- Sync billed seconds are `generatedNarrationDurationSec * 0.5`.
- Final render billed seconds are `finalVideo.durationSec * 0.5`.
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
- Storage and comparison safety use integer millisecond helpers; second fields are serialized from that source of truth.
- Starting a new paid billing period resets `cycleUsedSec` to `0`.
- `cycleReservedSec` may carry across a period transition only to preserve a legitimate in-flight finalize reservation until settle or failure release completes.
- No top-up fields exist in the launch cutover schema.

### Session estimate model

Additive server-owned session field:

```json
"billingEstimate": {
  "estimatedSec": 0,
  "source": "speech_duration | shot_durations | caption_timeline",
  "computedAt": "Timestamp"
}
```

Locked source order:
1. Backend-owned `speech_duration` estimate derived from the current script text, using a composite billing heuristic that compares whole-script speech duration with beat-aware speech duration before applying the story-level reserve pad.
2. Sum of shot `durationSec`, if shots exist and script text is unavailable.
3. Caption timeline total only as emergency last fallback.

Rules:
- Estimate is backend-owned only.
- Estimate is a conservative reservation target, not client-derived math.
- Finalize settlement truth remains `session.finalVideo.durationSec * 0.5`, serialized back to second-based contract fields from millisecond math.
- Passive `GET /api/story/:sessionId` and generic session saves must not silently overwrite or recalculate estimates.
- `speech_duration` uses a billing-specific composite text heuristic plus a small story-level reserve pad via `BILLING_ESTIMATE_HEURISTIC_PAD_SEC`.
- Beat-aware speech estimation applies low per-beat billing timing plus a capped boundary pad via `BILLING_ESTIMATE_PER_BEAT_BASE_SEC`, `BILLING_ESTIMATE_PER_BEAT_MIN_SEC`, `BILLING_ESTIMATE_BEAT_BOUNDARY_PAD_SEC`, and `BILLING_ESTIMATE_BEAT_BOUNDARY_PAD_MAX_SEC`.
- Phase 2 cannot be marked verified until representative supported stories prove the buffered estimate is not below billed duration for supported flows.

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
6. Compute `billedSec = session.finalVideo.durationSec * 0.5`.
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
- Add `voiceSync.nextEstimatedChargeSec` for the next explicit sync action.
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
      "source": "speech_duration | shot_durations | caption_timeline",
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
- `billedSec = finalVideo.durationSec * 0.5`.
- Same idempotency key cannot double-bill.
- Failure releases reserved seconds.
- Successful finalize persists short `billing`.
- Backend no longer debits credits or throws `INSUFFICIENT_CREDITS`.
- Render/finalize billing paths no longer infer paid/pro from credit balance.
- Phase 2 runtime currently uses the documented story-level reserve pad above on heuristic `speech_duration` estimates.
- Phase 2 is still blocked from being marked verified or release-ready until representative supported stories prove the buffered `estimatedSec >= billedSec`.
- The representative estimate-proof set must include:
  - a session whose reservation source is `speech_duration` at finalize start
  - a session whose reservation source is `shot_durations` at finalize start
  - a fallback session whose reservation source is `caption_timeline` at finalize start
  - at least one manual-script session that still finalizes through the normal TTS render path

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
- the minimum active non-mobile current-balance readers required to remove `/api/credits` from active caller usage:
  - `web/public/js/my-shorts.js`
  - `web/public/js/usage-ui.js`
  - active shared callers of `web/public/js/usage-ui.js`
- `/api/credits` route removal or immediate deprecation.

Temporary bridge:
- At most one short deprecation stub for `/api/credits` returning explicit removal error if implementation sequencing needs it.
- That stub may remain only as an explicit dead/deprecated endpoint once active callers are cut over, and must stay tracked for final removal in Phase 5.

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
- canonical Stripe commerce config.
- Stripe webhook.
- pricing, success, and billing-management pages.
- buy-credits surface retirement.
- legacy web account-state reads in commerce surfaces.

Temporary bridge:
- None. Legacy checkout bridges were removed in Phase 5.

Verification gates:
- `POST /api/checkout/start` accepts only monthly `plan` checkout semantics for `creator` and `pro`.
- Legacy checkout bridge routes are absent from mounted runtime.
- Webhook no longer grants credits and instead synchronizes `plan`, `membership`, and `usage` period state.
- Pricing is the only product-facing commerce page, `buy-credits.html` redirects to `pricing.html`, and portal return URLs land on `pricing.html`.
- Success/account confirmation uses backend-owned `GET /api/usage`, not raw Firestore membership reads.
- Web commerce surfaces no longer sell credits or one-time passes.

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
- final dead bridge route removal (`/api/credits`, `/api/checkout/session`, `/api/checkout/subscription`).
- compatibility-field removal (`isMember`, `subscriptionStatus`) from active runtime billing/entitlement paths.
- credit-derived heuristic removal from active backend guards/controllers/services.
- short-detail and web usage-surface compatibility artifact cleanup.
- retirement/removal of `src/services/credit.service.js` after dependency extraction.
- stale smoke/front-door doc cleanup for active truth alignment.

Temporary bridge:
- None.

Verification gates:
- No active code path reads, writes, grants, reserves, refunds, infers from, or displays credits.
- No canonical doc describes `/api/credits` or credit cost as active contract truth.
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
- Remove `GET /api/credits` from mounted runtime.
- Add `billingEstimate` to active story/session payloads.
- Add settled `billing` fields to finalize success payloads.
- Add `billing` fields to short detail/list payloads.
- Remove credit-native balance fields from mobile profile/settings usage.
- Remove credit-native pricing/buy/success payload assumptions from web.
- Rewrite `POST /api/checkout/start` around monthly time plans only.
- Remove legacy checkout routes `POST /api/checkout/session` and `POST /api/checkout/subscription` from mounted runtime.
- Remove credit-pack checkout semantics from active routes/pages and replace webhook credit grants with entitlement plus usage-period synchronization.

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
- Phase 2: no backend billing path depends on credits; finalize settles in seconds only; estimate-proof verification demonstrates the buffered `estimatedSec >= billedSec` on representative supported stories.
- Phase 3: no active caller uses `/api/credits`; mobile shows time-based language only.
- Phase 4: no checkout or webhook path grants credits; web catalog is time-only.
- Phase 5: no active code, docs, or tests encode credit semantics.

### Removal criteria
- `/api/credits` is absent from mounted runtime.
- `RENDER_CREDIT_COST` is absent from active runtime.
- No active entitlement heuristic reads `credits`.
- No active UI says `credits`.
- No active short response returns `credits`.
- Smoke/tests/specs no longer assert credit balance or credit cost.

## 10. Status Ledger

| Phase | Status |
| --- | --- |
| Phase 1 — Backend time-model foundation | Landed |
| Phase 2 — Backend finalize/time-billing cutover | In progress |
| Phase 3 — Caller migration and active contract cutover | Landed |
| Phase 4 — Stripe/catalog hard rewrite | Landed |
| Phase 5 — Credit removal and cleanup | Landed |
