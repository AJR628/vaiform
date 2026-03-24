# Beta Hardening Plan

**This doc is a plan/roadmap, not runtime truth.**

Current docs front door is `docs/DOCS_INDEX.md`.

For current backend/mobile contract truth, use:

- `docs/MOBILE_BACKEND_CONTRACT.md`
- `docs/MOBILE_HARDENING_PLAN.md`
- `docs/LEGACY_WEB_SURFACES.md`
- `docs/API_CONTRACT.md`
- `docs/COHESION_GUARDRAILS.md`

Evidence/history remains in:

- `docs/MOBILE_DOCS_VERIFICATION_REPORT.md`
- `docs/TRUTH_FREEZE_AUDIT_2026-02-28.md`

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

- Creative story flow:
  Draft path:
  `/api/story/start` -> `/api/story/generate` -> `/api/story/plan` -> `/api/story/search` -> `/api/assets/options`
  Editor/finalize path:
  `/api/story/update-shot`, `/api/story/search-shot`, `/api/story/update-video-cuts`, `/api/story/create-manual-session`, `/api/caption/preview`, `/api/story/finalize`, `GET /api/story/:sessionId`
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
  render/finalize are synchronous HTTP handlers; server timeout is 15 minutes (`server.js:24`, `server.js:32`)
- Current caller recovery note:
  creative article render now treats transport-level finalize failures (`HTTP_502`, `HTTP_504`, `IDEMPOTENT_IN_PROGRESS`) as status-verification mode, immediately polling `GET /api/story/:sessionId` before falling back to 5-second cadence (`web/public/js/pages/creative/creative.article.mjs:3766`, `web/public/js/pages/creative/creative.article.mjs:3861`, `web/public/js/pages/creative/creative.article.mjs:3964`, `src/middleware/idempotency.firestore.js:60-84`, `web/public/api.mjs:186-214`)
- Remaining implementation order:
  Phase D -> Phase C -> Phase E
- Closed / deferred note:
  Phase A runtime landed pending sacred smoke; Phase B is code-landed pending live Stripe replay smoke; Phase F is post-critical-cluster only.

## Current Triage (Repo-Derived, 2026-03-07)

### A - Launch-Critical Before Beta

- Add targeted rate limits to expensive story and assets routes and default-disable the unused `/api/story/render` path (`src/routes/assets.routes.js:9`, `src/routes/story.routes.js:498-518`, `src/routes/story.routes.js:595-633`, `src/routes/story.routes.js:778-856`, `src/routes/story.routes.js:891-992`, `src/utils/render.semaphore.js:1-22`).
- Put explicit aborts on the remaining unbounded LLM/provider calls that still sit on sacred story/search paths (`src/services/story.llm.service.js:307-360`, `src/services/story.llm.service.js:613-620`, `src/utils/link.extract.js:112-145`, `src/services/pixabay.videos.provider.js:42-44`, `src/services/nasa.videos.provider.js:52-54`, `src/services/nasa.videos.provider.js:92-94`).
- Re-run sacred story smoke on the landed outbound URL guardrails, covering blocked-host probes plus both manual and provider-backed clip finalize paths (`src/routes/story.routes.js:155-170`, `src/routes/story.routes.js:842-853`, `src/services/story.service.js:1528`, `src/services/story.service.js:1752`).
- Re-run live Stripe replay and sacred billing smoke before beta sign-off. The code path is landed, but this audit did not re-verify real Stripe delivery/replay behavior (`src/routes/stripe.webhook.js:339-523`, `src/controllers/checkout.controller.js:26-123`, `web/public/js/buy-credits.js:67-167`, `web/public/js/pricing.js:114`).

### B - Important, But Can Wait Until After The Cluster Above

- Add revoked-token checks to checkout and finalize once the trust-boundary and admission-control work is closed (`src/middleware/requireAuth.js:13`, `src/routes/checkout.routes.js:16-31`, `src/routes/story.routes.js:820-842`).
- Clean up CORS / preview-origin gating so `FRONTEND_URL` actually drives allowlisted origins instead of a hardcoded list plus `NODE_ENV`-based Replit preview matching (`src/app.js:47-55`, `src/app.js:61-99`).
- If beta traffic shows Stripe session spam, add low-rate per-UID throttles to `/api/checkout/*`; this is secondary to the story/render abuse surface (`src/routes/checkout.routes.js:16-31`).

### C - Not Worth Beta Time Right Now

- `tmp.js` external URL hardening. The current active callers only pass data URLs, so this is not an active beta trust boundary today (`src/utils/tmp.js:19-39`, `src/utils/ffmpeg.js:440`, `src/utils/ffmpeg.video.js:1129`).
- `req.session` / `req.isPro` cleanup in assets flow. The assumptions are misleading, but the effect is UX polish, not launch-blocking security or billing risk (`src/controllers/assets.controller.js:20-31`, `src/controllers/assets.controller.js:84-92`).
- Finalize response normalization for top-level `shortId`; keep it out of the beta hardening critical path unless a caller-backed contract change is already happening (`src/routes/story.routes.js:36-40`, `src/routes/story.routes.js:840-841`, `web/public/js/pages/creative/creative.article.mjs:3845-3856`).
- Observability expansion and fatal-error exit policy. Existing request IDs and error envelopes are sufficient for the current hardening pass; revisit only after the critical surface work lands and runtime supervision is clear (`src/middleware/reqId.js:4-8`, `src/middleware/error.middleware.js:15-50`, `server.js:12-17`).

## Phased Hardening Backlog

### Phase A - Outbound Fetch + SSRF Hardening

Status: Runtime landed; sacred smoke and blocked-host probes pending (2026-03-05 implementation)

#### Objective

Lock down the active user-controlled outbound URL paths without widening scope into unused helpers or unrelated route cleanup.

#### Repo Truth

- `/api/story/start` stores link input; `/api/story/generate` is the route that actually triggers `generateStory(...) -> generateStoryFromInput(...) -> extractContentFromUrl(...)` (`src/routes/story.routes.js:118-139`, `src/routes/story.routes.js:145-170`, `src/services/story.service.js:125-155`, `src/services/story.llm.service.js:158-168`).
- `src/utils/outbound.fetch.js` now centralizes `https://`-only enforcement, DNS-backed public-host checks, redirect-hop limits, and bounded text reads for active user-controlled outbound URLs (`src/utils/outbound.fetch.js:148-219`, `src/utils/outbound.fetch.js:221-267`).
- `src/utils/link.extract.js` now uses that shared policy with the existing 20s HTML fetch timeout plus a response-bytes cap before LLM/fallback parsing (`src/utils/link.extract.js:21-107`).
- `fetchVideoToTmp(...)` now applies the same policy on both HEAD and GET, and the helper is shared by manual finalize plus provider-backed render/timeline fetches (`src/utils/video.fetch.js:21-95`, `src/services/story.service.js:1528`, `src/services/story.service.js:1752`, `src/utils/ffmpeg.timeline.js:298`).
- Story route wrappers now map outbound-policy/media validation failures instead of collapsing them into generic 500s (`src/routes/story.routes.js:60-101`, `src/routes/story.routes.js:164-170`, `src/routes/story.routes.js:802-853`).

#### Why It Still Matters

- Beta sign-off still needs real blocked-host probes and sacred render smoke because this patch was source-verified, not full end-to-end smoked.
- HEAD preflight must remain timed best-effort. If providers mishandle HEAD, GET should still proceed unless policy already rejects the target or a successful HEAD already proved a size violation.
- Do not reopen this phase for `tmp.js`, `image.fetch.js`, auth, rate limiting, or generic fetch cleanup. Those belong to other phases or remain intentionally deferred.

#### Evidence Pointers

- `src/routes/story.routes.js:118`
- `src/routes/story.routes.js:145`
- `src/services/story.service.js:125`
- `src/services/story.llm.service.js:160`
- `src/utils/outbound.fetch.js:148`
- `src/utils/outbound.fetch.js:172`
- `src/utils/link.extract.js:21`
- `src/utils/link.extract.js:51`
- `src/utils/video.fetch.js:21`
- `src/utils/video.fetch.js:49`
- `src/services/story.service.js:1528`
- `src/services/story.service.js:1752`
- `src/utils/ffmpeg.timeline.js:298`

#### Scope Boundaries

Out of scope:

- `src/utils/tmp.js` and `src/utils/image.fetch.js` unless they gain active callers
- auth, rate limiting, parser/body-limit work
- provider replacement or search-ranking changes
- cleanup of unused generic helpers unless they become caller-backed

#### Patch Inventory

- `src/utils/outbound.fetch.js`
- `src/utils/link.extract.js`
- `src/utils/video.fetch.js`
- `src/services/story.llm.service.js`
- `src/routes/story.routes.js`

#### Acceptance Criteria

- Only public `https://` outbound fetches are allowed on active user-controlled link and clip paths.
- Redirects are capped and re-validated on every hop.
- Private, loopback, link-local, and localhost targets are rejected.
- Link extraction keeps its 20s fetch timeout and now caps response bytes before LLM/fallback parsing.
- Video HEAD preflight is timed but remains best-effort; GET still proceeds unless policy or confirmed size checks block the target.
- Manual clip finalize and normal provider-backed clip fetch paths both still work with valid public URLs.

#### Checklist

- [x] Scope locked (files to touch listed)
- [x] Patch landed
- [x] SSOT docs updated (ACTIVE_SURFACES / ROUTE_TRUTH_TABLE / API_CONTRACT as needed)
- [x] Verification suite green
- [ ] Manual sacred-pipeline smoke passed
- [x] Revert notes captured

#### Revert Notes

- Roll back `src/utils/outbound.fetch.js`, `src/utils/link.extract.js`, `src/utils/video.fetch.js`, `src/services/story.llm.service.js`, and `src/routes/story.routes.js` together so fetch policy, caller behavior, and error mapping stay aligned.
- If reverting runtime behavior, revert this plan/audit update in the same PR so Phase A does not appear landed when repo truth has moved backward.
- Do not partially revert only the route mapping or only one caller; mismatched policy coverage would recreate drift across sacred story surfaces.

### Phase B - Webhook Correctness

Status: Runtime landed; live Stripe verification pending (2026-03-05 audit)

#### Objective

Keep the landed webhook transaction model and finish beta sign-off with live replay verification instead of reopening billing code speculatively.

#### Repo Truth

- `checkout.session.completed` and `invoice.payment_succeeded` both resolve purchase context from Stripe metadata and run through one Firestore transaction that writes the user patch and the `stripe_webhook_events/{event.id}` marker together (`src/routes/stripe.webhook.js:84-239`, `src/routes/stripe.webhook.js:339-441`).
- Retryable handler failures bubble to the outer catch and return `500`; signature failures return `400`; ignored, duplicate, and processed events return `200` (`src/routes/stripe.webhook.js:470-523`, `docs/API_CONTRACT.md:67-73`).
- Renewal credits are gated to `invoice.billing_reason === 'subscription_cycle'`, which avoids initial-invoice double-credit (`src/routes/stripe.webhook.js:401-407`).
- Checkout controllers stamp purchase metadata from server-trusted `req.user`, not client-supplied body fields (`src/controllers/checkout.controller.js:45-58`, `src/controllers/checkout.controller.js:95-117`, `src/controllers/checkout.controller.js:148-202`).

#### Why It Still Matters

- The deep audit's earlier webhook gaps are no longer present in repo code.
- Beta sign-off still needs live Stripe replay verification because this audit only re-derived source truth, not real Stripe delivery behavior.

#### Evidence Pointers

- `src/controllers/checkout.controller.js:26`
- `src/controllers/checkout.controller.js:76`
- `src/controllers/checkout.controller.js:136`
- `src/routes/stripe.webhook.js:339`
- `src/routes/stripe.webhook.js:401`
- `src/routes/stripe.webhook.js:470`
- `src/routes/stripe.webhook.js:513`
- `web/public/js/buy-credits.js:67`
- `web/public/js/buy-credits.js:84`
- `web/public/js/buy-credits.js:167`
- `web/public/js/pricing.js:114`

#### Scope Boundaries

Out of scope:

- billing model redesign
- subscription lifecycle feature expansion beyond correctness of current flows
- admin tooling or reconciliation dashboards

#### Acceptance Criteria

- Plan checkout and credit-pack checkout both credit exactly once.
- Monthly plan renewals and monthly credit-pack renewals both credit exactly once.
- Retryable processing failures return `500`, not `200`.
- Signature failures still return `400`.
- Duplicate `event.id` replays are no-ops.
- Credit-pack subscriptions do not set `subscriptionStatus: 'active'`.
- Live Stripe replay confirms the landed behavior against the real webhook endpoint.

#### Checklist

- [x] Runtime patch landed
- [x] SSOT docs updated (ACTIVE_SURFACES / ROUTE_TRUTH_TABLE / API_CONTRACT as needed)
- [x] Verification suite green
- [ ] Live Stripe replay smoke rerun
- [ ] Sacred billing smoke rerun
- [x] Revert notes captured

#### Revert Notes

- Revert runtime behavior by rolling back `src/routes/stripe.webhook.js`, `src/controllers/checkout.controller.js`, `src/config/stripe.js`, and `package.json` together.
- Keep historical `users/{uid}/stripe_webhook_events/*` docs intact during revert; removing markers would recreate double-credit risk on replay.
- Revert SSOT/docs in the same PR as the runtime rollback so the plan and truth docs stay aligned.

### Phase C - Remaining Explicit Timeouts

Status: Not started (narrowed after Phase A landed on 2026-03-05)

#### Objective

Put explicit abort timeouts only on the outbound calls that are still unbounded on active story, search, and render-adjacent paths.

#### Why It Matters

- Story OpenAI generate/retry/plan calls are still unbounded.
- `link.extract.js` now times the HTML fetch/body read, but its LLM extraction call is still unbounded.
- Pixabay and NASA fetches are still unbounded.
- Pexels, TTS, and video HEAD/download already have explicit timeout wrappers and should not be churned without cause.

#### Evidence Pointers

- `src/services/story.llm.service.js:307`
- `src/services/story.llm.service.js:357`
- `src/services/story.llm.service.js:613`
- `src/utils/link.extract.js:112`
- `src/utils/link.extract.js:133`
- `src/services/pixabay.videos.provider.js:42`
- `src/services/nasa.videos.provider.js:52`
- `src/services/nasa.videos.provider.js:92`
- `src/services/pexels.videos.provider.js:53`
- `src/services/tts.service.js:288`

#### Scope Boundaries

Out of scope:

- retry policy redesign
- queueing or background execution
- provider selection or ranking changes
- Pexels, TTS, or Phase A fetch wrappers unless the current wrappers are proven broken

#### Patch Inventory

- `src/services/story.llm.service.js`
- `src/utils/link.extract.js`
- `src/services/pixabay.videos.provider.js`
- `src/services/nasa.videos.provider.js`

#### Acceptance Criteria

- Story generate, retry, and plan OpenAI calls have explicit abort timeouts.
- Link extraction's LLM extraction call has an explicit abort timeout.
- Pixabay and NASA calls have explicit abort timeouts.
- Existing Phase A wrappers on link HTML fetch and video HEAD/download remain intact.
- Existing Pexels and TTS timeout behavior remains intact.

#### Checklist

- [ ] Scope locked (files to touch listed)
- [ ] Patch landed
- [ ] SSOT docs updated (ACTIVE_SURFACES / ROUTE_TRUTH_TABLE / API_CONTRACT as needed)
- [x] Verification suite green
- [ ] Manual sacred-pipeline smoke passed
- [ ] Revert notes captured

### Phase D - Rate Limiting + Admission Control

Status: Not started (2026-03-05 audit)

#### Objective

Add targeted admission control to the expensive story and asset surfaces and close the hidden render bypass surface.

#### Why It Matters

- Caption preview already has a real rate limit, but story search/manual/finalize and assets options do not.
- Current web callers finalize through `/api/story/finalize`; the active creative caller now recovers transport-level `HTTP_502` / `HTTP_504` and `IDEMPOTENT_IN_PROGRESS` by polling `GET /api/story/:sessionId`, while `/api/story/render` remains mounted without a caller-backed need.
- Render capacity is still 3 concurrent jobs per process, so the remaining beta work here is admission control rather than more finalize UX band-aids.

#### Evidence Pointers

- `src/routes/caption.preview.routes.js:91`
- `src/routes/assets.routes.js:9`
- `src/routes/story.routes.js:477`
- `src/routes/story.routes.js:498`
- `src/routes/story.routes.js:595`
- `src/routes/story.routes.js:778`
- `src/routes/story.routes.js:820`
- `src/routes/story.routes.js:891`
- `src/utils/render.semaphore.js:1`
- `web/public/js/pages/creative/creative.article.mjs:3766`
- `web/public/js/pages/creative/creative.article.mjs:3861`
- `web/public/js/pages/creative/creative.article.mjs:3964`
- `src/middleware/idempotency.firestore.js:60`
- `web/public/api.mjs:186`

#### Scope Boundaries

Out of scope:

- WAF or CDN-level rate limiting
- distributed quota systems
- background job queue rollout
- adding a persisted `rendering` status purely to mask transport timeouts; the active caller now recovers through canonical session polling instead
- duplicate rate limiting on `/generate` and `/plan` unless the existing daily script cap proves insufficient

#### Patch Inventory

- `src/middleware/rateLimits.js` (new, if it keeps the diff cohesive)
- `src/routes/assets.routes.js`
- `src/routes/story.routes.js`

#### Acceptance Criteria

- Expensive `/api/assets/options`, `/api/story/search`, `/api/story/search-shot`, `/api/story/create-manual-session`, and `/api/story/finalize` paths have explicit per-IP / per-UID rate limits.
- `/api/story/finalize` remains the canonical render path.
- `/api/story/render` is default-disabled unless explicitly re-enabled.
- Finalize replay, success, and error responses stay within the canonical envelope.

#### Breaking-Change Risk

Potential breaking change - requires caller audit first:

- Default-disabling `/api/story/render` in case any non-web caller still uses it.
- Tight rate limits that accidentally block normal multi-step editor flows.

#### Checklist

- [ ] Scope locked (files to touch listed)
- [ ] Caller audit required
- [ ] Patch landed
- [ ] SSOT docs updated (ACTIVE_SURFACES / ROUTE_TRUTH_TABLE / API_CONTRACT as needed)
- [x] Verification suite green
- [ ] Manual sacred-pipeline smoke passed
- [ ] Revert notes captured

### Phase E - Auth Revocation Scope + Optional Body-Limit Tightening

Status: Not started (2026-03-05 audit)

#### Objective

Apply revocation-aware auth checks to billing and finalize, then revisit parser tightening only if it can be done without disrupting sacred callers.

#### Why It Matters

- `requireAuth` still verifies Firebase tokens without `checkRevoked`.
- Billing and finalize remain the highest-value authenticated write surfaces.
- Global 10 MB JSON/urlencoded parsers are wider than current beta needs, but caption preview and the Stripe webhook already have tighter route-specific parsers, so parser tightening is secondary.

#### Evidence Pointers

- `src/middleware/requireAuth.js:13`
- `src/routes/checkout.routes.js:16`
- `src/routes/story.routes.js:820`
- `src/app.js:118`
- `src/app.js:129`
- `src/app.js:130`
- `src/routes/caption.preview.routes.js:109`
- `src/routes/stripe.webhook.js:470`

#### Scope Boundaries

Out of scope:

- auth architecture rewrite
- session middleware introduction
- client auth UX redesign
- parser-limit churn without caller proof for the affected route bodies

#### Patch Inventory

- `src/middleware/requireAuth.js`
- `src/routes/checkout.routes.js`
- `src/routes/story.routes.js`
- `src/app.js` (only if parser limits are actually tightened)

#### Acceptance Criteria

- Billing and finalize use revocation-aware auth checks.
- Lower-risk routes may remain on the cheaper auth path if needed for beta.
- If global JSON/urlencoded limits are tightened, caption preview keeps its explicit 200 KB parser and the Stripe webhook keeps its explicit 1 MB raw parser.

#### Checklist

- [ ] Scope locked (files to touch listed)
- [ ] Patch landed
- [ ] SSOT docs updated (ACTIVE_SURFACES / ROUTE_TRUTH_TABLE / API_CONTRACT as needed)
- [x] Verification suite green
- [ ] Manual sacred-pipeline smoke passed
- [ ] Revert notes captured

### Phase F - Observability Minimal

Status: Deferred (not beta blocker as of 2026-03-05)

#### Objective

Add one request-scoped logging path for beta-critical routes only if the critical-cluster work still leaves debugging blind.

#### Why It Is Deferred

- Request IDs already exist.
- The error middleware already logs `requestId`, route, and status.
- Story and Stripe paths already emit route-local error logs.
- This is not the best use of beta hardening time until the trust boundaries and admission controls are closed.

#### Evidence Pointers

- `src/middleware/reqId.js:4`
- `src/http/respond.js:14`
- `src/middleware/error.middleware.js:15`
- `src/routes/stripe.webhook.js:470`
- `src/services/story.service.js:2102`

#### Scope Boundaries

Out of scope:

- tracing vendor integration
- log pipeline or dashboard rollout
- broad log cleanup across all services

#### Patch Inventory

- `src/middleware/requestAudit.js` (new, only if needed)
- `src/app.js`
- `src/routes/stripe.webhook.js` (only if request-scoped fields are needed)

#### Acceptance Criteria

- Critical routes emit one request-scoped audit line with `requestId`, path, status, duration, and UID if present.
- Existing API envelopes remain unchanged.
- Error logs remain correlated through `requestId`.

#### Checklist

- [ ] Scope locked (files to touch listed)
- [ ] Patch landed
- [ ] SSOT docs updated (ACTIVE_SURFACES / ROUTE_TRUTH_TABLE / API_CONTRACT as needed)
- [x] Verification suite green
- [ ] Manual sacred-pipeline smoke passed
- [ ] Revert notes captured

## Decision Log

Append newest entries on top.

| Date       | Decision                                                                                                                                                                                                                                                | Why                                                                                                                                                                                             |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-03-07 | Landed creative finalize transport-timeout recovery in the active caller by reusing `GET /api/story/:sessionId` polling for non-JSON `HTTP_502` / `HTTP_504` and `IDEMPOTENT_IN_PROGRESS`, with an immediate first poll and neutral verification state. | Live repro showed the backend finishing render after a transport timeout; the smallest safe fix was frontend-only recovery rather than widening backend state or introducing jobs.              |
| 2026-03-05 | Landed Phase A on the active caller-backed link and clip fetch paths with one shared outbound policy and route-level failure mapping.                                                                                                                   | Repo truth shows `/api/story/start` only stores link input, `/api/story/generate` triggers article fetch, and `fetchVideoToTmp(...)` is shared by both manual and provider-backed render flows. |
| 2026-03-05 | Reclassified webhook correctness as code-landed and verification-driven. The remaining beta task is live Stripe replay and sacred billing smoke, not more speculative webhook rewrites.                                                                 | Source audit shows exact-once transaction handling, retry semantics, renewal gating, and plan-cancellation handling are already present in repo code.                                           |
| 2026-03-05 | Explicitly demoted `tmp.js` external URL hardening, assets `req.session` cleanup, finalize `shortId` normalization, and observability expansion out of the launch-critical cluster.                                                                     | Those items are either not active caller-backed trust boundaries or are polish / post-critical-cluster concerns.                                                                                |
| 2026-03-04 | Phase B implementation locked webhook ownership by purchase family: initial subscription credits stay on `checkout.session.completed`, renewals move to `invoice.payment_succeeded` with an explicit renewal gate.                                      | Prevent double-credit across the initial checkout event and the first invoice while keeping monthly renewals supported.                                                                         |
| 2026-03-04 | Created `docs/BETA_HARDENING_PLAN.md` from the beta audit as a living roadmap.                                                                                                                                                                          | Keep hardening work phased and traceable without turning the plan into SSOT.                                                                                                                    |

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

- `node scripts/test-timeouts.mjs`
- `node scripts/test-caption-preview-contract.mjs`
- `node scripts/smoke.mjs`
- `node scripts/verify-checkout-trust-boundary.mjs`
- Replay the same Stripe `event.id` after a successful webhook delivery and confirm no second credit grant.
- After frontend finalize timeout recovery lands, force a long render until the browser sees non-JSON `HTTP_502` / `HTTP_504` or `IDEMPOTENT_IN_PROGRESS`, confirm the UI stays in neutral verification mode, does an immediate first `GET /api/story/:sessionId` poll, then continues at 5-second cadence until `status === rendered` with `finalVideo.url`.
- Refresh or reopen the same session after a transport timeout and confirm `GET /api/story/:sessionId` still reflects rendered truth; broader refresh-resume UX remains a separate follow-up from this frontend-only patch.
- After Phase A lands, manually probe blocked link/manual-clip hosts (`127.0.0.1`, `169.254.169.254`, RFC1918 space, `http://`) and smoke both manual clip finalize and normal provider-backed clip finalize.
- After Phase D lands, probe rate limits on `/api/assets/options`, `/api/story/search`, `/api/story/search-shot`, `/api/story/create-manual-session`, and `/api/story/finalize`.

## Sacred Manual Smoke

- Creative story draft path:
  `/api/story/start`, `/api/story/generate`, `/api/story/plan`, `/api/story/search`, `/api/assets/options`
- Creative story editor/finalize path:
  `/api/story/update-shot`, `/api/story/search-shot`, `/api/story/update-video-cuts`, `/api/story/create-manual-session`, `/api/caption/preview`, `/api/story/finalize`, `GET /api/story/:sessionId`
- My Shorts flow:
  `/api/credits`, `/api/shorts/mine`, `/api/shorts/:jobId`
- Pricing + buy-credits flow:
  `/api/checkout/start`, `/api/checkout/session`, `/api/checkout/subscription`, `/api/checkout/portal`, `/stripe/webhook`

## Session Use Notes

- Start each hardening session by re-reading this file plus the runtime SSOT docs.
- Before editing, refresh evidence with `rg` and current `file:line` anchors.
- Update phase status, checklist items, decision log, and revert notes as work lands.
