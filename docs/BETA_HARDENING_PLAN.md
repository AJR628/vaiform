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
- Remaining implementation order:
  Phase A -> Phase D -> Phase C -> Phase E
- Closed / deferred note:
  Phase B is code-landed pending live Stripe replay smoke; Phase F is post-critical-cluster only.

## Current Triage (Repo-Derived, 2026-03-05)

### A - Launch-Critical Before Beta

- Close the active outbound URL trust boundaries on link input and manual clip URLs (`src/services/story.llm.service.js:151-161`, `src/utils/link.extract.js:43-65`, `src/routes/story.routes.js:836-850`, `src/services/story.service.js:1752`, `src/utils/video.fetch.js:11-25`).
- Add targeted rate limits to expensive story and assets routes and default-disable the unused `/api/story/render` path (`src/routes/assets.routes.js:9`, `src/routes/story.routes.js:451-467`, `src/routes/story.routes.js:548-585`, `src/routes/story.routes.js:728-800`, `src/routes/story.routes.js:836-945`, `src/utils/render.semaphore.js:1-22`).
- Put explicit aborts on the remaining unbounded LLM/provider calls that still sit on sacred story/search paths (`src/services/story.llm.service.js:303-360`, `src/services/story.llm.service.js:609-616`, `src/utils/link.extract.js:121-128`, `src/services/pixabay.videos.provider.js:42-44`, `src/services/nasa.videos.provider.js:52-54`, `src/services/nasa.videos.provider.js:92-94`, `src/utils/video.fetch.js:16`).
- Re-run live Stripe replay and sacred billing smoke before beta sign-off. The code path is landed, but this audit did not re-verify real Stripe delivery/replay behavior (`src/routes/stripe.webhook.js:339-523`, `src/controllers/checkout.controller.js:26-123`, `web/public/js/buy-credits.js:67-167`, `web/public/js/pricing.js:114`).

### B - Important, But Can Wait Until After The Cluster Above

- Add revoked-token checks to checkout and finalize once the trust-boundary and admission-control work is closed (`src/middleware/requireAuth.js:13`, `src/routes/checkout.routes.js:16-31`, `src/routes/story.routes.js:768-790`).
- Clean up CORS / preview-origin gating so `FRONTEND_URL` actually drives allowlisted origins instead of a hardcoded list plus `NODE_ENV`-based Replit preview matching (`src/app.js:47-55`, `src/app.js:61-99`).
- If beta traffic shows Stripe session spam, add low-rate per-UID throttles to `/api/checkout/*`; this is secondary to the story/render abuse surface (`src/routes/checkout.routes.js:16-31`).

### C - Not Worth Beta Time Right Now

- `tmp.js` external URL hardening. The current active callers only pass data URLs, so this is not an active beta trust boundary today (`src/utils/tmp.js:19-39`, `src/utils/ffmpeg.js:440`, `src/utils/ffmpeg.video.js:1129`).
- `req.session` / `req.isPro` cleanup in assets flow. The assumptions are misleading, but the effect is UX polish, not launch-blocking security or billing risk (`src/controllers/assets.controller.js:20-31`, `src/controllers/assets.controller.js:84-92`).
- Finalize response normalization for top-level `shortId`; keep it out of the beta hardening critical path unless a caller-backed contract change is already happening (`src/routes/story.routes.js:35-40`, `src/routes/story.routes.js:789-790`, `web/public/js/pages/creative/creative.article.mjs:3921-3931`).
- Observability expansion and fatal-error exit policy. Existing request IDs and error envelopes are sufficient for the current hardening pass; revisit only after the critical surface work lands and runtime supervision is clear (`src/middleware/reqId.js:4-8`, `src/middleware/error.middleware.js:15-50`, `server.js:12-17`).

## Phased Hardening Backlog

### Phase A - Outbound Fetch + SSRF Hardening

Status: Not started (2026-03-05 audit)

#### Objective

Lock down the active user-controlled outbound URL paths without widening scope into unused helpers.

#### Why It Matters

- Link-mode story input fetches a user-supplied URL through `extractContentFromUrl(...)`.
- Manual clip sessions accept arbitrary `selectedClip.url` values that later flow into `fetchVideoToTmp(...)` during render.
- `link.extract.js` already has a 20s timeout, but it still follows redirects without host re-validation and does not cap response bytes.
- `video.fetch.js` enforces `https:` and a download size cap, but it still lacks private-host blocking and a timed HEAD probe.

#### Evidence Pointers

- `src/services/story.llm.service.js:151`
- `src/utils/link.extract.js:43`
- `src/utils/link.extract.js:65`
- `src/routes/story.routes.js:836`
- `src/routes/story.routes.js:913`
- `src/services/story.service.js:1752`
- `src/utils/video.fetch.js:11`
- `src/utils/video.fetch.js:16`

#### Scope Boundaries

Out of scope:

- `src/utils/tmp.js` and `src/utils/image.fetch.js` unless they gain active callers
- async job queue work
- provider replacement or search-ranking changes
- cleanup of currently unused generic helpers unless they become caller-backed

#### Patch Inventory

- `src/utils/link.extract.js`
- `src/utils/video.fetch.js`
- `src/routes/story.routes.js` (only if upfront URL validation is added)

#### Acceptance Criteria

- Only public `https://` outbound fetches are allowed on active user-controlled paths.
- Redirects are capped and re-validated on every hop.
- Private, loopback, link-local, and localhost targets are rejected.
- Link extraction keeps its timeout and gains a response-bytes cap.
- Video download helpers keep their size cap and gain the same host policy.
- Creative story flow and manual finalize flow still work with valid public URLs.

#### Checklist

- [ ] Scope locked (files to touch listed)
- [ ] Patch landed
- [ ] SSOT docs updated (ACTIVE_SURFACES / ROUTE_TRUTH_TABLE / API_CONTRACT as needed)
- [ ] Verification suite green
- [ ] Manual sacred-pipeline smoke passed
- [ ] Revert notes captured

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

Status: Not started (2026-03-05 audit)

#### Objective

Put explicit abort timeouts only on the outbound calls that are still unbounded on active story, search, and render-adjacent paths.

#### Why It Matters

- Story OpenAI calls are still unbounded.
- `link.extract.js` times the HTML fetch, but its LLM extraction call is still unbounded.
- Pixabay and NASA fetches are still unbounded.
- Video HEAD probing is still unbounded even though the actual download is timed.
- Pexels and TTS already have explicit timeout wrappers and should not be churned without cause.

#### Evidence Pointers

- `src/services/story.llm.service.js:303`
- `src/services/story.llm.service.js:353`
- `src/services/story.llm.service.js:609`
- `src/utils/link.extract.js:121`
- `src/services/pixabay.videos.provider.js:42`
- `src/services/nasa.videos.provider.js:52`
- `src/services/nasa.videos.provider.js:92`
- `src/utils/video.fetch.js:16`
- `src/services/pexels.videos.provider.js:53`
- `src/services/pexels.photos.provider.js:28`
- `src/services/tts.service.js:288`

#### Scope Boundaries

Out of scope:

- retry policy redesign
- queueing or background execution
- provider selection or ranking changes
- Pexels or TTS timeout rewrites unless the current wrappers are proven broken

#### Patch Inventory

- `src/services/story.llm.service.js`
- `src/utils/link.extract.js`
- `src/services/pixabay.videos.provider.js`
- `src/services/nasa.videos.provider.js`
- `src/utils/video.fetch.js`

#### Acceptance Criteria

- Story generate, retry, and plan OpenAI calls have explicit abort timeouts.
- Link extraction's LLM fallback has an explicit abort timeout.
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

Status: Not started (2026-03-05 audit)

#### Objective

Add targeted admission control to the expensive story and asset surfaces and close the hidden render bypass surface.

#### Why It Matters

- Caption preview already has a real rate limit, but story search/manual/finalize and assets options do not.
- Current web callers finalize through `/api/story/finalize` and poll `GET /api/story/:sessionId`; `/api/story/render` remains mounted without a caller-backed need.
- Render capacity is still 3 concurrent jobs per process.

#### Evidence Pointers

- `src/routes/caption.preview.routes.js:91`
- `src/routes/assets.routes.js:9`
- `src/routes/story.routes.js:451`
- `src/routes/story.routes.js:548`
- `src/routes/story.routes.js:728`
- `src/routes/story.routes.js:768`
- `src/routes/story.routes.js:836`
- `src/utils/render.semaphore.js:1`
- `web/public/js/pages/creative/creative.article.mjs:3484`
- `web/public/js/pages/creative/creative.article.mjs:3782`
- `web/public/js/pages/creative/creative.article.mjs:3853`
- `web/public/js/pages/creative/creative.article.mjs:3921`

#### Scope Boundaries

Out of scope:

- WAF or CDN-level rate limiting
- distributed quota systems
- background job queue rollout
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
- [ ] Verification suite green
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
- `src/routes/story.routes.js:768`
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
- [ ] Verification suite green
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
- [ ] Verification suite green
- [ ] Manual sacred-pipeline smoke passed
- [ ] Revert notes captured

## Decision Log

Append newest entries on top.

| Date       | Decision                                                                                                                                                                                                           | Why                                                                                                                                                   |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-03-05 | Reclassified webhook correctness as code-landed and verification-driven. The remaining beta task is live Stripe replay and sacred billing smoke, not more speculative webhook rewrites.                            | Source audit shows exact-once transaction handling, retry semantics, renewal gating, and plan-cancellation handling are already present in repo code. |
| 2026-03-05 | Explicitly demoted `tmp.js` external URL hardening, assets `req.session` cleanup, finalize `shortId` normalization, and observability expansion out of the launch-critical cluster.                                | Those items are either not active caller-backed trust boundaries or are polish / post-critical-cluster concerns.                                      |
| 2026-03-04 | Phase B implementation locked webhook ownership by purchase family: initial subscription credits stay on `checkout.session.completed`, renewals move to `invoice.payment_succeeded` with an explicit renewal gate. | Prevent double-credit across the initial checkout event and the first invoice while keeping monthly renewals supported.                               |
| 2026-03-04 | Created `docs/BETA_HARDENING_PLAN.md` from the beta audit as a living roadmap.                                                                                                                                     | Keep hardening work phased and traceable without turning the plan into SSOT.                                                                          |

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
- After Phase A lands, manually probe blocked link/manual-clip hosts (`127.0.0.1`, `169.254.169.254`, RFC1918 space, `http://`).
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
