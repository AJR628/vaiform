# Beta Hardening Plan

**This doc is a plan/roadmap, not runtime truth.**

Runtime SSOT remains:

- `docs/ACTIVE_SURFACES.md`
- `ROUTE_TRUTH_TABLE.md`
- `docs/API_CONTRACT.md`
- `docs/TRUTH_FREEZE_AUDIT_2026-02-28.md` (evidence/history)

## Purpose

Use this file as the living beta hardening roadmap and implementation checklist.

Use it to:

- keep phase scope stable across sessions
- track status and revert notes
- force SSOT-safe implementation discipline

Do not use this file as runtime truth for routes, callers, or contracts.

## Meta Rules

- **Patch -> Tests -> SSOT Updates -> Evidence -> Revert**
- Any surface, caller, or API contract change requires SSOT updates in the same PR.
- Audit-first always: before proposing changes, re-verify with repo evidence (`file:line` and `rg`). No assumptions.
- Keep diffs minimal and scoped to beta blockers first.

## Sacred Pipelines (Must Not Break)

- Creative article flow:
  `/api/story/start` -> `/api/story/generate` -> `/api/story/plan` -> `/api/story/search` -> `/api/assets/options` -> `/api/caption/preview` -> `/api/story/finalize`
- My Shorts flow:
  `/api/credits` -> `/api/shorts/mine` -> `/api/shorts/:jobId`
- Pricing + buy-credits flow:
  `/api/checkout/start` -> `/api/checkout/session` -> `/api/checkout/subscription` -> `/api/checkout/portal` -> `/stripe/webhook`

## Direction Snapshot

- Goal:
  beta-ready, safe against abuse, predictable debugging
- Current deployment assumption:
  single-instance Node with render semaphore
- Capacity envelope:
  3 concurrent renders per process (`src/utils/render.semaphore.js:2`)
- Current render model note:
  render/finalize are synchronous HTTP handlers; server timeout is 15 minutes (`server.js:32`, `server.js:37`)
- Recommended implementation order:
  Phase B -> Phase A -> Phase C -> Phase D -> Phase E -> Phase F

## Phased Hardening Backlog

### Phase A - Outbound Fetch + SSRF Hardening

Status: Not started (2026-03-04)

#### Objective

Add a single safe outbound fetch path for active user-influenced URLs and reject unsafe hosts, schemes, redirects, and oversized responses.

#### Why It Matters

- Link-mode story input currently triggers server-side fetch of arbitrary URLs.
- Manual clip URLs can stage server-side downloads later in render/timeline paths.
- Current helpers lack private-network blocking and redirect hop re-validation.

#### Evidence Pointers

- `src/services/story.llm.service.js:159`
- `src/utils/link.extract.js:45`
- `src/utils/link.extract.js:65`
- `src/routes/story.routes.js:844`
- `src/services/story.service.js:719`
- `src/services/story.service.js:1752`
- `src/utils/video.fetch.js:11`
- `src/utils/video.fetch.js:16`

#### Scope Boundaries

Out of scope:

- async job queue work
- provider replacement or search-ranking changes
- cleanup of currently unused generic helpers unless they become caller-backed

#### Patch Inventory

- `src/utils/outbound.fetch.js` (new)
- `src/utils/link.extract.js`
- `src/utils/video.fetch.js`
- `src/routes/story.routes.js`

#### Acceptance Criteria

- Only public `https://` outbound fetches are allowed on active user-controlled paths.
- Redirects are capped and re-validated on every hop.
- Private, loopback, link-local, and local-host targets are rejected.
- Link extraction has a text/HTML max-bytes cap.
- Video download helpers keep their size cap and gain the same host policy.
- Creative article flow and manual session flow still work with valid public URLs.

#### Checklist

- [ ] Scope locked (files to touch listed)
- [ ] Patch landed
- [ ] SSOT docs updated (ACTIVE_SURFACES / ROUTE_TRUTH_TABLE / API_CONTRACT as needed)
- [ ] Verification suite green
- [ ] Manual sacred-pipeline smoke passed
- [ ] Revert notes captured

### Phase B - Webhook Correctness

Status: In progress (2026-03-04)

Runtime + SSOT landed. Live Stripe verification and sacred billing smoke remain pending.

#### Objective

Make Stripe webhook handling retry-safe, exact-once, and compatible with both plan checkout and buy-credits checkout metadata.

#### Why It Matters

- Active buy-credits checkout metadata does not match the current webhook expectation.
- The webhook currently returns `200` even when processing fails.
- The processed marker is written after the user update, outside the transaction.

#### Current Truth Lock

| Flow                      | Endpoint + caller                                               | Current metadata shape                                                                                                         | Initial grant event          | Renewal event                       | Current gap                                                                            |
| ------------------------- | --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ---------------------------- | ----------------------------------- | -------------------------------------------------------------------------------------- |
| One-time credit pack      | `/api/checkout/session` via `web/public/js/buy-credits.js`      | `uid`, `email`, `priceId`, `quantity`, `credits`, `kind:'onetime'`, `client_reference_id=uid`                                  | `checkout.session.completed` | n/a                                 | Current webhook ignores `priceId` purchases because it only processes `metadata.plan`. |
| Monthly credit pack       | `/api/checkout/subscription` via `web/public/js/buy-credits.js` | Session + `subscription_data.metadata`: `uid`, `email`, `priceId`, `credits`, `kind:'subscription'`, `client_reference_id=uid` | `checkout.session.completed` | `invoice.payment_succeeded` renewal | Current webhook has renewal TODO only; no renewal credits are granted.                 |
| Creator/Pro one-time plan | `/api/checkout/start` via `web/public/js/pricing.js`            | `uid`, `email`, `plan`, `billing:'onetime'`, `client_reference_id=uid`                                                         | `checkout.session.completed` | n/a                                 | Current webhook grants credits, but marker write is non-atomic with the user update.   |
| Creator/Pro monthly plan  | `/api/checkout/start` via `web/public/js/pricing.js`            | Session + `subscription_data.metadata`: `uid`, `email`, `plan`, `billing:'monthly'`, `client_reference_id=uid`                 | `checkout.session.completed` | `invoice.payment_succeeded` renewal | Current webhook has renewal TODO only and can return `200` even when processing fails. |

#### Evidence Pointers

- `src/controllers/checkout.controller.js:47`
- `src/controllers/checkout.controller.js:95`
- `src/controllers/checkout.controller.js:108`
- `src/controllers/checkout.controller.js:202`
- `src/routes/stripe.webhook.js:35`
- `src/routes/stripe.webhook.js:84`
- `src/routes/stripe.webhook.js:161`
- `src/routes/stripe.webhook.js:339`
- `src/routes/stripe.webhook.js:401`
- `src/routes/stripe.webhook.js:444`
- `src/routes/stripe.webhook.js:473`
- `src/routes/stripe.webhook.js:483`
- `web/public/js/buy-credits.js:67`
- `web/public/js/buy-credits.js:84`
- `web/public/js/pricing.js:114`
- `web/public/buy-credits.html:156`
- `web/public/buy-credits.html:184`
- `web/public/buy-credits.html:217`

#### Scope Boundaries

Out of scope:

- full billing model redesign
- subscription lifecycle feature expansion beyond correctness of current flows
- admin tooling or reconciliation dashboards

#### Patch Inventory

- `src/routes/stripe.webhook.js`
- `src/controllers/checkout.controller.js`
- `src/config/stripe.js`
- `package.json`
- `docs/ACTIVE_SURFACES.md`
- `ROUTE_TRUTH_TABLE.md`
- `docs/API_CONTRACT.md`
- `docs/TRUTH_FREEZE_AUDIT_2026-02-28.md`
- `docs/BETA_HARDENING_PLAN.md`

#### Acceptance Criteria

- Plan checkout and credit-pack checkout both credit exactly once.
- Monthly plan renewals and monthly credit-pack renewals both credit exactly once.
- Retryable processing failures return `500`, not `200`.
- Signature failures still return `400`.
- Event processed markers are persisted atomically with the user update.
- Duplicate `event.id` replays become no-ops.
- `invoice.payment_succeeded` is gated so the initial subscription invoice does not double-credit the first cycle.
- Credit-pack subscriptions do not set `subscriptionStatus: 'active'`.

#### Checklist

- [x] Scope locked (files to touch listed)
- [x] Evidence lock captured in this plan file
- [x] Patch landed
- [x] SSOT docs updated (ACTIVE_SURFACES / ROUTE_TRUTH_TABLE / API_CONTRACT as needed)
- [x] Verification suite green
- [ ] Manual sacred-pipeline smoke passed
- [x] Revert notes captured

#### Revert Notes

- Revert runtime behavior by rolling back `src/routes/stripe.webhook.js`, `src/controllers/checkout.controller.js`, `src/config/stripe.js`, and `package.json` together.
- Keep historical `users/{uid}/stripe_webhook_events/*` docs intact during revert; removing markers would recreate double-credit risk on replay.
- Revert SSOT/docs in the same PR as the runtime rollback so the plan and truth docs stay aligned.

### Phase C - Timeouts Everywhere

Status: Not started (2026-03-04)

#### Objective

Put explicit abort timeouts on remaining unbounded provider and LLM calls.

#### Why It Matters

- Story LLM calls are still unbounded.
- Pixabay and NASA fetches are still unbounded.
- Untimed provider calls can pin request handlers until the global server timeout.

#### Evidence Pointers

- `src/services/story.llm.service.js:303`
- `src/services/story.llm.service.js:353`
- `src/services/story.llm.service.js:609`
- `src/utils/link.extract.js:121`
- `src/services/pixabay.videos.provider.js:42`
- `src/services/nasa.videos.provider.js:52`
- `src/services/nasa.videos.provider.js:92`
- `src/utils/video.fetch.js:16`
- `src/services/tts.service.js:288`
- `src/services/pexels.videos.provider.js:53`

#### Scope Boundaries

Out of scope:

- retry policy redesign
- queueing or background execution
- provider selection or ranking changes

#### Patch Inventory

- `src/services/story.llm.service.js`
- `src/utils/link.extract.js`
- `src/services/pixabay.videos.provider.js`
- `src/services/nasa.videos.provider.js`
- `src/utils/video.fetch.js`

#### Acceptance Criteria

- Story generate/plan/link-extract OpenAI calls have explicit abort timeouts.
- Pixabay and NASA calls have explicit abort timeouts.
- Video HEAD probing is timed as well as the download itself.
- Existing Pexels and TTS timeout behavior remains intact.

#### Checklist

- [ ] Scope locked (files to touch listed)
- [ ] Patch landed
- [ ] SSOT docs updated (ACTIVE_SURFACES / ROUTE_TRUTH_TABLE / API_CONTRACT as needed)
- [ ] Verification suite green
- [ ] Manual sacred-pipeline smoke passed
- [ ] Revert notes captured

### Phase D - Rate Limiting + Admission Control

Status: Not started (2026-03-04)

#### Objective

Add targeted rate limits to expensive routes and close the hidden render bypass surface.

#### Why It Matters

- Caption preview is rate-limited, but other expensive routes are not.
- Story search and finalize are abuse-prone under untrusted beta users.
- `/api/story/render` is still default-reachable with only a credit pre-check.

#### Evidence Pointers

- `src/routes/caption.preview.routes.js:91`
- `src/routes/story.routes.js:451`
- `src/routes/story.routes.js:548`
- `src/routes/story.routes.js:730`
- `src/routes/story.routes.js:738`
- `src/routes/story.routes.js:768`
- `src/utils/render.semaphore.js:2`
- `web/public/js/pages/creative/creative.article.mjs:3853`
- `src/routes/story.routes.js:35`
- `src/routes/story.routes.js:51`

#### Scope Boundaries

Out of scope:

- WAF or CDN-level rate limiting
- distributed quota systems
- background job queue rollout

#### Patch Inventory

- `src/middleware/rateLimits.js` (new)
- `src/routes/assets.routes.js`
- `src/routes/story.routes.js`
- `src/middleware/idempotency.firestore.js`

#### Acceptance Criteria

- Expensive story and asset routes have explicit per-IP and per-UID rate limits.
- `/api/story/finalize` remains the canonical render path.
- `/api/story/render` is default-disabled unless explicitly re-enabled.
- Finalize replay/success/error responses stay within the canonical envelope.

#### Breaking-Change Risk

⚠️ Potential breaking — requires caller audit first

- Normalizing `/api/story/finalize` success shape if top-level `shortId` is removed.
- Default-disabling `/api/story/render` in case any non-web caller still uses it.

#### Checklist

- [ ] Scope locked (files to touch listed)
- [ ] Caller audit required
- [ ] Patch landed
- [ ] SSOT docs updated (ACTIVE_SURFACES / ROUTE_TRUTH_TABLE / API_CONTRACT as needed)
- [ ] Verification suite green
- [ ] Manual sacred-pipeline smoke passed
- [ ] Revert notes captured

### Phase E - Auth Revocation Scope + Body Limits

Status: Not started (2026-03-04)

#### Objective

Apply token revocation checks on sensitive routes and tighten default request body limits.

#### Why It Matters

- `requireAuth` does not currently use `checkRevoked`.
- Billing and finalize are the highest-value auth surfaces.
- Global 10 MB JSON limits are wider than current beta needs.

#### Evidence Pointers

- `src/middleware/requireAuth.js:13`
- `src/routes/checkout.routes.js:16`
- `src/routes/story.routes.js:768`
- `src/app.js:129`
- `src/routes/caption.preview.routes.js:113`
- `src/routes/stripe.webhook.js:15`

#### Scope Boundaries

Out of scope:

- auth architecture rewrite
- session middleware introduction
- client auth UX redesign

#### Patch Inventory

- `src/middleware/requireAuth.js`
- `src/routes/checkout.routes.js`
- `src/routes/story.routes.js`
- `src/app.js`

#### Acceptance Criteria

- Billing and finalize use revocation-aware auth checks.
- Lower-risk routes can stay on the cheaper auth path if desired.
- Global JSON/urlencoded limits are tightened.
- Caption preview and Stripe webhook retain their explicit route-specific limits.

#### Checklist

- [ ] Scope locked (files to touch listed)
- [ ] Patch landed
- [ ] SSOT docs updated (ACTIVE_SURFACES / ROUTE_TRUTH_TABLE / API_CONTRACT as needed)
- [ ] Verification suite green
- [ ] Manual sacred-pipeline smoke passed
- [ ] Revert notes captured

### Phase F - Observability Minimal

Status: Not started (2026-03-04)

#### Objective

Add one request-scoped logging path for beta-critical routes without turning logging into a redesign project.

#### Why It Matters

- Request IDs already exist and should be leveraged consistently.
- Beta debugging needs one stable log line per critical request.
- Current route/service logging is verbose but not consistently request-scoped.

#### Evidence Pointers

- `src/middleware/reqId.js:4`
- `src/http/respond.js:14`
- `src/http/respond.js:28`
- `src/middleware/error.middleware.js:15`
- `src/routes/stripe.webhook.js:16`
- `src/services/story.service.js:1908`

#### Scope Boundaries

Out of scope:

- tracing vendor integration
- log pipeline or dashboard rollout
- broad log cleanup across all services

#### Patch Inventory

- `src/middleware/requestAudit.js` (new)
- `src/app.js`
- `src/routes/stripe.webhook.js` (only if needed for request-scoped fields)

#### Acceptance Criteria

- Critical routes emit one request-scoped audit line with `requestId`, path, status, duration, and UID if present.
- Existing API envelopes remain unchanged.
- Error logs remain correlated through `requestId`.

#### Checklist

- [ ] Scope locked (files to touch listed)
- [ ] Patch landed
- [ ] SSOT docs updated (ACTIVE_SURFACES / ROUTE_TRUTH_TABLE / API_CONTRACT as needed)
- [ ] Verification suite green
- [ ] Manual sacred-pipeline smoke passed
- [ ] Revert notes captured

## Decision Log

Append newest entries on top.

| Date       | Decision                                                                                                                                                                                                           | Why                                                                                                                     |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------- |
| 2026-03-04 | Phase B implementation locked webhook ownership by purchase family: initial subscription credits stay on `checkout.session.completed`, renewals move to `invoice.payment_succeeded` with an explicit renewal gate. | Prevent double-credit across the initial checkout event and the first invoice while keeping monthly renewals supported. |
| 2026-03-04 | Created `docs/BETA_HARDENING_PLAN.md` from the beta audit as a living roadmap.                                                                                                                                     | Keep hardening work phased and traceable without turning the plan into SSOT.                                            |

## Verification Suite

These commands must stay green:

```powershell
npm run lint
npm run format:check
npm run check:netlify-redirects
npm run check:root-api-callers
npm run check:hardcoded-backend-origins
node scripts/check-responses.js
```

Recommended targeted checks as phases land:

- `node scripts/test-ssrf-guards.mjs`
- `node scripts/test-webhook-retry.mjs`
- `node scripts/test-story-rate-limits.mjs`
- `stripe listen --forward-to http://localhost:3000/stripe/webhook`
- Replay the same Stripe `event.id` after a successful delivery and confirm no second credit grant.

## Sacred Manual Smoke

- Creative article flow:
  `/api/story/start`, `/api/story/generate`, `/api/story/plan`, `/api/story/search`, `/api/assets/options`, `/api/caption/preview`, `/api/story/finalize`
- My Shorts flow:
  `/api/credits`, `/api/shorts/mine`, `/api/shorts/:jobId`
- Pricing + buy-credits flow:
  `/api/checkout/start`, `/api/checkout/session`, `/api/checkout/subscription`, `/api/checkout/portal`, `/stripe/webhook`

## Session Use Notes

- Start each hardening session by re-reading this file plus the runtime SSOT docs.
- Before editing, refresh evidence with `rg` and current `file:line` anchors.
- Update phase status, checklist items, decision log, and revert notes as work lands.
