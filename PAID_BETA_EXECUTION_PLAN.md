# Paid Beta Execution Plan

- Status: WORKING (organizing document only — no code changes in this pass)
- Created: 2026-05-03
- Source: reconciles `docs/PAID_BETA_AUDIT_PLAN.md` against current repo state
- Companion: `docs/PAID_BETA_AUDIT_PLAN.md` (the four-track audit), `docs/FINAL_PAID_BETA_LAUNCH_PLAN.md` (Phases 1–3 closure log), `docs/MAINTENANCE_FRONT_DOOR.md` (live route authority)

The audit plan describes the right work but treats every track as equally urgent. This document re-orders that work for one practical path: ship paid beta safely first, then close drift, then optimize. It also marks every major audit claim as Verified / Inconclusive / Already-fixed / False / Defer so we don't waste implementation time on the wrong thing.

---

## 1. Current State Summary

### Already complete (per `docs/FINAL_PAID_BETA_LAUNCH_PLAN.md` closure log + repo evidence)
- Active mobile runtime type-checks and CI enforces it (Phase 1).
- Real Pro checkout + webhook + finalize round-trip was manually proved on the launch path (Phase 2). `stripe_webhook_events` replay guard already protects `checkout.session.completed`.
- Legacy blocking `POST /api/story/render` is fenced behind `ENABLE_STORY_RENDER_ROUTE=1` (Phase 2).
- `PAID_BETA_STRICT_ENV=1` fail-closed env gate is in place (Phase 3).
- 5xx sanitization on active paid-beta surfaces lands via `src/middleware/error.middleware.js` (Phase 3).
- Sentry base layer wired through `instrument.mjs` with `surface/service/flow/request_id` tags (`docs/MAINTENANCE_FRONT_DOOR.md:17-23`).
- Read-only Sentry incident bridge phase 1 shipped (`MAINTENANCE_FRONT_DOOR.md:25-34`).
- `/api/caption/preview` already has `express-rate-limit` (per-user key, IP fallback, 20/min) — `src/routes/caption.preview.routes.js:5,92-110`.
- `/api/admin/finalize/data` is gated by `requireFinalizeDashboardDataEnabled + requireAuth + requireFinalizeDashboardFounder` (`src/routes/admin.finalize.routes.js:58-76`).
- `/diag` and `/api/diag/headers` are env-gated to `VAIFORM_DEBUG=1` at mount time (`src/app.js:220,224`).
- Firestore + Storage rules deny by default; entitlement fields blocked from client writes (`firestore.rules:14-20`).
- Repo envelope contract documented and partially enforced via `npm run check:responses` and the changed-file gate.

### In progress
- The four-track audit (`docs/PAID_BETA_AUDIT_PLAN.md`) — drafted, proposed; this document is the execution layer on top.
- Phase 5 of `FINAL_PAID_BETA_LAUNCH_PLAN.md`: live operator rehearsal, still open.

### Pending (real beta-blockers, not yet started)
- Stripe webhook lifecycle gaps for refunds, disputes, downgrades, payment-failed.
- Race-free transactions on `incrementFreeShortsUsed` and the cycle-seconds counter.
- Founder-auth gate on `/diag/*` when `VAIFORM_DEBUG=1` (env gate alone is not enough if the flag ever leaks).
- Founder-auth gate on the `/admin/finalize` HTML shell (the JSON `data` route is gated; the static page is not).
- Rate limits on `/api/story/finalize`, `/api/checkout/start`, `/api/checkout/portal`, `/api/story/generate`, `/api/story/plan`.
- Explicit `Sentry.captureException` in the global error handler so worker-side failures aren't lost.
- Sanitized logging in the ElevenLabs adapter and NASA provider.
- `/readiness` probe distinct from `/health`.

### Should be paused
- Track 4 (large-file decomposition). High-risk, behavior-adjacent, and any decomposition collides with the safety/contract patches we want to land first.
- Broad doc rewrites and archive reshuffles.
- Renaming/moving `firebase-service-account.json` until we have one quiet maintenance window — moving the file mid-week risks a boot-time outage if any worker entry is missed.

---

## 2. Now / Next / Later Roadmap

### NOW — beta-blocking (do before charging real users beyond the closed Phase 2 proof)

1. **Stripe lifecycle coverage.** Refund / dispute / `subscription.updated` / `payment_failed`. Without these, a refunded user keeps credits, a downgraded user keeps Pro entitlement, and a failed renewal silently keeps Pro alive. (Track 1 step 1.)
2. **Race-free entitlement counters.** Wrap `incrementFreeShortsUsed` and the cycle-seconds increment in Firestore transactions. Cheap to do, removes a real cap-bypass under parallel calls. (Track 1 step 2.)
3. **Founder-auth on debug + admin surfaces.** Add `requireAuth + requireFinalizeDashboardFounder` to every `/diag/*` route and the `/admin/finalize` HTML page; refuse to mount `/diag` in `NODE_ENV=production`. (Track 1 step 5.)
4. **Rate limits on the four expensive write routes.** `/api/story/finalize`, `/api/checkout/start`, `/api/checkout/portal`, plus `/api/story/generate` and `/api/story/plan`. Reuse the working caption-preview pattern. (Track 1 step 3.)
5. **Explicit 5xx Sentry capture + sanitize ElevenLabs/NASA logs.** Today the global handler relies on `Sentry.setupExpressErrorHandler`; worker-side and out-of-Express failures are silent. ElevenLabs and NASA `console.log` raw bodies and stacks. (Track 1 steps 7 + Track 2 step 4.)

### NEXT — important during early beta, not a launch blocker

6. **Caption preview / final render parity** (Track 3, all steps). The drift is real (anchor convention, font-shrink divergence, hardcoded font path), but the symptom is "preview doesn't quite match final," not "users get charged twice." Schedule it for the first beta week.
7. **API contract envelope cleanup** in `diag.routes.js` (10 sites), `diag.headers.routes.js` (1 site), `story.routes.js` (4 sites). (Track 2 step 2.)
8. **`/readiness` probe** that pings Firebase Admin, Stripe, configured TTS provider. Useful for deploy gating; not a launch blocker. (Track 2 step 5.)
9. **Mobile contract alignment in `MOBILE_BACKEND_CONTRACT.md`** — caption preview accepts `style`, finalize emits top-level `shortId`/`finalize`. (Track 2 step 3.)
10. **Truth-doc verified-date sync** across `DOCS_INDEX.md`, `MAINTENANCE_FRONT_DOOR.md`, `FINAL_PAID_BETA_LAUNCH_PLAN.md`. (Track 2 step 6.)
11. **Promote `npm run check:responses` (full scan) into CI.** (Track 2 step 7.)

### LATER — defer past beta unless a specific incident forces it

- Track 4 in full. The five large files are uncomfortable but not unsafe. Decompose only after the safety + parity work is in.
- `web/` directory disposition. Owned by a separate decision; not on the live mobile path.
- `docs/_archive/` + `docs/archive/` merge.
- Moving `firebase-service-account.json` out of the project root. Already gitignored; the marginal safety gain is small and the breakage risk is real.
- Splitting the Stripe webhook handler.
- Inline `safeParse` → middleware migration in `caption.preview.routes.js`.

---

## 3. Recommended First 5 Implementation Slices

### Slice 1 — Stripe lifecycle (refund / dispute / sub.updated / payment_failed)
- **Why it matters:** Today a refunded customer keeps credits; a downgraded subscription keeps Pro entitlement; a failed renewal looks identical to "still paid." This is the single biggest paid-trust hole.
- **Files likely involved:** `src/routes/stripe.webhook.js` (handler dispatch + new `case` arms), `src/services/user.service.js` (entitlement reset path), `src/services/usage.service.js` (cycle reset).
- **Risk:** Medium. Webhook handlers run on real money events. Mistakes silently corrupt entitlements.
- **Tests/proofs:** Replay each new event type twice with the existing replay-guard fixture; verify credits do not double-grant or double-revoke. Manual: trigger one real refund in Stripe test mode against the closed Phase 2 proof user; confirm credits revert.
- **Do not touch:** The existing three handlers, the `stripe_webhook_events` table schema, anything in `src/services/story.service.js`.
- **Best agent:** Replit/main agent. Money-correctness work needs read access to live Firestore docs and end-to-end test runs.

### Slice 2 — Race-free counters + idempotency on remaining mutators
- **Why it matters:** Two parallel finalize requests can both pass `enforceFreeDailyShortsCap` because the read and the increment are not in a transaction. Cheap to fix, removes a real abuse path.
- **Files likely involved:** `src/services/user.service.js:49+` (`incrementFreeShortsUsed`), `src/services/usage.service.js`, `src/middleware/planGuards.js`, `src/middleware/idempotency.firestore.js`.
- **Risk:** Low–medium. Transactional rewrites are localized.
- **Tests/proofs:** Add a small parallel-request test under `test/contracts/` that fires N concurrent finalize-admit calls against a fixture user with cap=1; assert exactly one passes.
- **Do not touch:** Finalize state machine, attempts table, story service.
- **Best agent:** Codex (small surface, well-bounded change).

### Slice 3 — Founder-auth gate on diag and admin HTML + production refusal of `/diag`
- **Why it matters:** Today `VAIFORM_DEBUG=1` is a single-knob risk; if it ever flips on in production, every `/diag/*` route is anonymously reachable. The `/admin/finalize` HTML page is reachable today whenever `FINALIZE_DASHBOARD_ENABLED=1`, even unauthenticated (only the JSON data route is gated).
- **Files likely involved:** `src/app.js:182-225` (mount conditions), `src/routes/diag.routes.js`, `src/routes/diag.headers.routes.js`, `src/routes/admin.finalize.routes.js:24-56`, `src/middleware/finalizeDashboardAccess.js`.
- **Risk:** Low. Adds checks; does not change happy paths.
- **Tests/proofs:** Add a check to `scripts/check-privilege-escalation.mjs` (run by `npm run test:security`) asserting that with `NODE_ENV=production` the `/diag/*` routes are not mounted, and that an unauthenticated GET on `/admin/finalize` returns 401/403.
- **Do not touch:** `requireAuth` itself, `finalizeDashboardAccess.js` allowlist semantics.
- **Best agent:** Codex.

### Slice 4 — Rate limits on the four expensive write routes
- **Why it matters:** Today only `/api/caption/preview` has IP/user-keyed rate limiting. A user looping `/api/story/finalize` or `/api/checkout/start` can run up real provider cost (and fees).
- **Files likely involved:** `src/routes/story.routes.js` (mount sites for `/generate`, `/plan`, `/finalize`), `src/routes/checkout.routes.js`, plus a new shared `src/middleware/rateLimits.js` derived from the existing `caption.preview.routes.js:92-110` factory so we don't duplicate config.
- **Risk:** Low–medium. The risk is over-tightening and breaking a legitimate retry on `/finalize`. Keep the limit generous (e.g. 10/min on finalize, 30/min on generate) and emit `Retry-After`.
- **Tests/proofs:** Add a small contract test that confirms 429 with the `RATE_LIMIT_EXCEEDED` envelope after the threshold.
- **Do not touch:** The existing caption-preview limiter (it works).
- **Best agent:** Codex.

### Slice 5 — Explicit Sentry 5xx capture + sanitize ElevenLabs/NASA logs
- **Why it matters:** Worker-side or post-response failures escape the Express error handler today; the only thing catching them is the implicit `Sentry.setupExpressErrorHandler`. ElevenLabs and NASA modules `console.log` request bodies (potential PII) and full stacks unredacted.
- **Files likely involved:** `src/middleware/error.middleware.js`, `src/adapters/elevenlabs.adapter.js`, `src/services/nasa.videos.provider.js`, `src/observability/logger.js`, `src/observability/redact.js`.
- **Risk:** Low. Additive.
- **Tests/proofs:** Run `npm run sentry:verify` after the change; confirm one captured event. Inspect ElevenLabs adapter manually: no raw body printed.
- **Do not touch:** The Sentry init in `instrument.mjs`, redaction allowlist semantics.
- **Best agent:** Codex.

---

## 4. Audit Claims — Verification Status

| Audit claim | Status | Evidence |
|---|---|---|
| Stripe webhook only handles 3 events | **Verified** | `src/routes/stripe.webhook.js:436-442` — `checkout.session.completed`, `invoice.payment_succeeded`, `customer.subscription.deleted` only. |
| Rate limit only on `/api/caption/preview` | **Verified** | `rg express-rate-limit src/routes` → only `caption.preview.routes.js:5,92`. Limit is 20/min per-user with IP fallback. |
| `incrementFreeShortsUsed` is non-transactional | **Verified** | `src/services/user.service.js:49+` defines the function; `rg runTransaction src/services/user*.js src/services/usage.service.js` returns no matches. |
| `/diag` is mounted only when `VAIFORM_DEBUG=1` | **Verified — and partially mitigates the audit's "leak" claim** | `src/app.js:220,224`. Real residual risk: no founder-auth check inside, and no `NODE_ENV=production` refusal. |
| `/admin/finalize` HTML shell is unauthenticated | **Verified** | `src/routes/admin.finalize.routes.js:24-56` — only `isFinalizeDashboardEnabled` gates the static and `GET /admin/finalize` routes; only `/api/admin/finalize/data:58-76` adds `requireAuth` + founder allowlist. |
| Manual `res.json` sites: `diag.routes.js`=10, `story.routes.js`=4, `diag.headers.routes.js`=1 | **Verified** | `rg -c` over `src/routes/`. |
| Five oversized files (5304 / 3011 / 2255 / 2001 / 1937 lines) | **Verified** | `wc -l` on each. |
| `Sentry.captureException` not called explicitly in error middleware | **Verified** | `rg captureException src/middleware/error.middleware.js` returns nothing; only `Sentry.init` in `instrument.mjs:94`. |
| ElevenLabs and NASA modules log raw bodies via `console.log` | **Verified** | `src/adapters/elevenlabs.adapter.js:71-72,98-129+`, `src/services/nasa.videos.provider.js:24-83`. |
| `firebase-service-account.json` contains live private key but is gitignored | **Verified** | File contents include real `private_key`; `.gitignore:143 *.json`; `git ls-files` does not list it. |
| `web/` is a 90 MB legacy frontend with its own `node_modules` | **Verified** | `du -sh web/node_modules` = 90 MB. |
| `docs/_archive/` (127 files) overlaps with `docs/archive/` | **Verified** | `find docs/_archive docs/archive -type f \| wc -l`. |
| No `/readiness` route exists distinct from `/health` | **Verified** | `rg "readiness" src/` returns nothing; only `/health` and `/api/health` mounted (`src/app.js:168-179`). |
| Caption: `yPx_png` anchor disagreement (doc top-left vs renderer center) | **Inconclusive — needs hands-on parity reproduction** | The subagent finding cites `renderCaptionImage.js:215,331` and `02-meta-contract-v3-raster.md:9`. The files exist; the conclusion needs a 1-hour hands-on bisect before we trust it. |
| Caption: `compile.js` does not auto-shrink, renderer does | **Inconclusive — needs side-by-side run** | Same: file references are real (`compile.js` is 3.3 KB and clamps font; renderer iterates). Plausible but worth confirming with one parity run before re-architecting. |
| Caption: hardcoded `/usr/share/fonts/...` in `ffmpeg.video.js` | **Verified (paths exist in source)** | Subagent cited `src/utils/ffmpeg.video.js:527-528`. Operationally we should also check whether the paths happen to exist on the deploy image; the audit plan still stands either way. |
| Caption: `overlay.helpers.js` throws when `rasterW >= 1080` | **Verified** | Subagent cited line 102. The frame width is 1080 ⇒ this is a real off-by-one. |
| `MOBILE_BACKEND_CONTRACT.md` claims mobile does not send `style` while route reads it | **Verified** | Route reads `req.body.style` in caption preview; subagent cited `caption.preview.routes.js:154`. |
| Truth-doc verified-date drift across canonical docs | **Verified** | `DOCS_INDEX.md` 2026-04-11 vs `MAINTENANCE_FRONT_DOOR.md` 2026-04-04 vs `FINAL_PAID_BETA_LAUNCH_PLAN.md` 2026-04-03. |
| Worker duplication (root + `src/workers/`) is a real footgun | **Verified — but lower priority than the audit framed it** | Both files exist; the root entries are package.json's runtime entrypoints and import the real implementations. Annoying, not unsafe. |
| `ROUTE_TRUTH_TABLE.md` is missing many real routes | **Already-known / partially superseded** | `MAINTENANCE_FRONT_DOOR.md:50-53,94-96` already states `ROUTE_TRUTH_TABLE.md` is "Reference Only" and not the route-truth doc. The right action is a banner pointing at `MAINTENANCE_FRONT_DOOR.md`, not a full rewrite. |
| Five legacy `test-*.mjs` at root with no caller | **Verified** | `rg test-font-fix\|test-overlay\|test-proxy --type js -g '!node_modules'` shows them only self-referenced. |
| Phase 2/3/4 already closed in `FINAL_PAID_BETA_LAUNCH_PLAN.md` | **Already-fixed (closures recorded)** | `docs/FINAL_PAID_BETA_LAUNCH_PLAN.md:43-101`. Avoid re-implementing closed items; treat them as background. |
| `rasterW > 1080` clamp is needed | **Defer to Track 3** | Single-line fix, but it is one of several caption-only changes that should land in one focused pass, not as a one-off. |

---

## 5. Claims to Defer or Set Aside For This Pass

- **Splitting `story.service.js` (5304) and `ffmpeg.video.js` (3011).** Real maintainability cost, no user-visible safety win. Defer behind the safety + parity slices.
- **Moving `firebase-service-account.json`.** Already gitignored; moving it now risks a boot outage if any of `start`, `start:worker:finalize`, `start:worker:preview`, or `instrument.mjs` looks for the old path. Schedule for a quiet maintenance window after Slices 1–5.
- **Doc archive merge (`docs/_archive` vs `docs/archive`).** Pure organization; no runtime impact.
- **Inline `safeParse` migration in `caption.preview.routes.js`.** Already called out in `COHESION_GUARDRAILS.md` as a separate consolidation item.
- **Promoting `npm run check:responses` (full scan) into CI before fixing the diag/story envelope drift.** Will fail loudly. Land it in NEXT, after Slice in Track 2 step 2 closes the existing offenders.
- **Web directory disposition.** Decoupled from mobile beta path.
- **`POST /api/story/render` related work** — already closed (`FINAL_PAID_BETA_LAUNCH_PLAN.md:68-73`).

---

## 6. Agent Allocation

### Replit / main agent (high-effort, end-to-end)
- Slice 1 — Stripe lifecycle handlers and the live test-mode replay/refund verification. Needs Firebase + Stripe state.
- Track 3 (caption parity) once we get there. Needs FFmpeg locally and a parity diff loop.
- Live operator rehearsal called out in `FINAL_PAID_BETA_LAUNCH_PLAN.md` Phase 5.

### Codex / small-commit lane
- Slice 2 — race-free counters (small, well-tested transformation).
- Slice 3 — auth gates on diag/admin (mechanical).
- Slice 4 — rate limits (mechanical, follow caption-preview template).
- Slice 5 — error-middleware Sentry call + adapter log routing through `observability/logger.js`.
- Track 2 step 2 — envelope cleanup in diag and story routes.
- Track 2 step 6 — verified-date sync across the three canonical docs.

### Manual founder checks
- Run a real refund and a real downgrade in Stripe test mode after Slice 1; confirm Firestore entitlement is correct end-to-end.
- Manually verify the `/admin/finalize` page returns 401/403 to a non-allowlisted Google account after Slice 3.
- Confirm `npm run sentry:verify` produces one captured event after Slice 5.
- Decide the disposition of `web/` (out of scope for this plan).

---

## 7. Stop Conditions — When to Pause and Ask

Pause and request review before continuing if any of the following happens:

1. A Stripe webhook change in Slice 1 would alter behavior for `checkout.session.completed` or `invoice.payment_succeeded` (these are closed and proven; do not touch their semantics).
2. A counter/transaction change in Slice 2 would change the `users/*` schema or move entitlement fields out of `users/*`.
3. A diag/admin auth change in Slice 3 would block the existing founder allowlist or change the `FINALIZE_DASHBOARD_ENABLED` semantics.
4. A rate-limit change in Slice 4 would set thresholds without finding caller-evidence (look at `web/public/api.mjs` and the mobile `MOBILE_USED_SURFACES.md` first).
5. A logging change in Slice 5 would silence an existing structured `logger.*` call rather than just routing `console.log` through redaction.
6. Any caption-parity change starts touching `compile.js` AND `renderCaptionImage.js` AND `ffmpeg.video.js` AND `overlay.helpers.js` in the same patch — split it.
7. Any work begins to require a `story.service.js`, `story.routes.js`, `caption.preview.routes.js`, or `ffmpeg.video.js` file split. That is Track 4 and is paused.
8. A doc edit in Track 2 starts rewriting `MAINTENANCE_FRONT_DOOR.md` or `COHESION_GUARDRAILS.md` instead of the drifted docs (`API_CONTRACT.md`, `MOBILE_BACKEND_CONTRACT.md`, `ROUTE_TRUTH_TABLE.md`).
9. The audit's "Inconclusive" caption claims (anchor convention, font-shrink) are not reproduced before the renderer is changed. Reproduce first.
10. We approach 5 simultaneous in-flight slices. Cap at 2 concurrent: one Replit, one Codex.
