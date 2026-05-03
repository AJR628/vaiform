# Paid Beta Readiness — Audit & Action Plan

- Status: WORKING PLAN
- Owner: founder + main agent
- Created: 2026-05-03
- Source: full no-stone-unturned audit of backend, routes, workers, payments, captions, docs, and hygiene

This is the working reference for the four tracks coming out of the paid-beta audit. Each track is also a project task in the agent task list. File order here matches the recommended execution order: safety first, then doc/contract cohesion, caption parity in parallel, then hygiene last so file splits do not collide with the other three.

## Track Overview

| # | Track | Depends on | Why it matters |
|---|-------|------------|----------------|
| 1 | Safety & money-correctness hardening | — | Closes real holes that put paid users (and the founder) at risk. |
| 2 | API contract & truth-doc cohesion | 1 | Brings docs and code back to one coherent picture; closes envelope drift. |
| 3 | Caption preview / final render parity | — | Makes preview pixel-faithful to final render so users see what they'll get. |
| 4 | Codebase hygiene & large-file decomposition | 1, 2, 3 | Structural cleanup; makes future work cheaper and safer. Runs last to avoid file-split conflicts. |

Tracks 1 and 3 are independent and can run in parallel.

---

## Track 1 — Safety & Money-Correctness Hardening

### What & Why
Vaiform is being prepared for paid users. Today there are several real safety holes — bypassable plan/credit guards, missing Stripe lifecycle handlers (refunds/downgrades), unauthenticated diag/admin surfaces leaking internal state when the debug or dashboard flags are on, missing brute-force protection on expensive endpoints, and a few read-modify-write race conditions on usage counters. Each is small in isolation but collectively they put both the user (incorrect billing, lost data) and the founder (chargebacks, abuse, info leak) at risk. This track closes that set.

### Done looks like
- A real refund or canceled subscription correctly revokes credits / resets entitlement instead of being silently ignored.
- The same Stripe event delivered twice never grants credits twice (already true for `checkout.session.completed`, extend the same guarantee to every newly handled event).
- A user who clicks Generate / Finalize / Checkout 50 times in 5 seconds is rate-limited at the route layer, not just by the daily cap.
- The free-shorts daily counter and the per-cycle render seconds counter cannot be exceeded by parallel requests crossing a day boundary or racing each other.
- When `VAIFORM_DEBUG=1` is on, `/diag/*` and `/api/diag/headers` either require an authenticated founder email (same allowlist used by the finalize dashboard) or are unreachable in any non-development environment.
- When `FINALIZE_DASHBOARD_ENABLED=1`, the dashboard HTML shell is only served to an authenticated, allowlisted founder — not anonymous visitors.
- No endpoint accepts a client-supplied uid, email, or plan price; everything that mutates entitlement comes from `req.user` or server-side config.
- A short, runnable proof script (extend the existing `scripts/verify-checkout-trust-boundary.mjs` pattern) demonstrates each fix.

### Out of scope
- Splitting large files / decomposing `story.service.js` (covered by Track 4).
- Reworking the finalize state machine itself (it is already covered by its own spec).
- Adding new product features.
- Rewriting Firestore rules beyond closing a real bypass.

### Steps
1. **Stripe webhook lifecycle coverage.** Add idempotent handlers for `charge.refunded`, `charge.dispute.created`, `customer.subscription.updated` (downgrade/cancel-at-period-end), and `invoice.payment_failed`. Reuse the existing `stripe_webhook_events` transactional replay guard so the new events get the same once-only semantics.
2. **Race-free counters.** Move the free-daily-shorts reset and the cycle-seconds increment into Firestore transactions so two parallel requests crossing the day boundary cannot both pass the gate.
3. **Server-side rate limits on expensive routes.** Extend the existing `express-rate-limit` pattern (already used on `/api/caption/preview`) to `/api/story/generate`, `/api/story/plan`, `/api/story/finalize`, `/api/checkout/start`, and `/api/checkout/portal`. Use a per-user key when authenticated, IP fallback otherwise.
4. **Idempotency on remaining credit-mutating service calls.** Add an idempotency-key surface (request-scoped header reuse) for `incrementFreeShortsUsed` and the voice-sync charge path so a retried request never double-counts.
5. **Lock down diag and admin surfaces.** Require `requireAuth` + the founder allowlist (reuse `requireFinalizeDashboardFounder`) on every `/diag/*` route and on the dashboard HTML page itself, not just `/api/admin/finalize/data`. Refuse to mount `/diag/*` when `NODE_ENV=production` regardless of `VAIFORM_DEBUG`.
6. **Trust boundary proofs.** Extend `scripts/verify-checkout-trust-boundary.mjs` (or add sibling scripts) to assert: no client-supplied `uid`/`email`/`plan price` reaches a writer; replayed webhook events do not double-grant; rate limits trip at the documented threshold; diag routes return 404 in production. Wire into `npm run test:security`.
7. **Sanitize logs that touch user content.** The TTS/ElevenLabs adapter and the NASA provider currently `console.log` raw request bodies and stack traces. Route them through `src/observability/logger.js` so redaction applies and request context is attached.

### Relevant files
- `src/routes/stripe.webhook.js`
- `src/middleware/idempotency.firestore.js`
- `src/middleware/planGuards.js`
- `src/middleware/requireAuth.js`
- `src/middleware/finalizeDashboardAccess.js`
- `src/middleware/envCheck.js`
- `src/services/usage.service.js`
- `src/services/user.service.js`
- `src/services/user-doc.service.js`
- `src/controllers/checkout.controller.js`
- `src/controllers/limits.controller.js`
- `src/routes/diag.routes.js`
- `src/routes/diag.headers.routes.js`
- `src/routes/admin.finalize.routes.js`
- `src/routes/story.routes.js`
- `src/routes/checkout.routes.js`
- `src/routes/caption.preview.routes.js:5,92,113`
- `src/adapters/elevenlabs.adapter.js`
- `src/services/nasa.videos.provider.js`
- `src/observability/logger.js`
- `src/observability/redact.js`
- `scripts/verify-checkout-trust-boundary.mjs`
- `scripts/check-privilege-escalation.mjs`
- `firestore.rules`
- `storage.rules`
- `docs/MOBILE_BACKEND_CONTRACT.md`
- `docs/MAINTENANCE_FRONT_DOOR.md`

---

## Track 2 — API Contract & Truth-Doc Cohesion

### What & Why
The repo's own canonical doc (`docs/COHESION_GUARDRAILS.md`) requires every JSON endpoint to use the `{success,data,requestId}` / `{success:false,error,detail,fields?,requestId}` envelope via `respond.ok`/`respond.fail`. In practice `src/routes/diag.routes.js` (10 manual `res.json` sites), `src/routes/diag.headers.routes.js` (1), and `src/routes/story.routes.js` (4) bypass the helper. Several routes that exist in code (`/api/story/update-caption-style`, `/update-caption-meta`, `/update-shot`, `/update-video-cuts`, `/search-shot`, `/insert-beat`, `/delete-beat`, `/update-beat-text`, `/timeline`, `/captions`, `/manual`, `/create-manual-session`, `/api/user/setup`, `/api/user/me`) are missing from `docs/API_CONTRACT.md` and `ROUTE_TRUTH_TABLE.md`. The "last verified" dates across canonical docs are also out of sync (`DOCS_INDEX.md` 2026-04-11 vs `MAINTENANCE_FRONT_DOOR.md` 2026-04-04 vs `FINAL_PAID_BETA_LAUNCH_PLAN.md` 2026-04-03), and `MOBILE_BACKEND_CONTRACT.md` claims mobile "does not send `style`" while `caption.preview.routes.js:154` reads it. This track brings docs and code back into a single coherent picture so neither a future agent nor a future developer wastes time chasing ghosts.

### Done looks like
- Every active route in `src/app.js` is listed in `docs/API_CONTRACT.md` with method, auth, request schema, success shape, error codes — and the converse: every doc claim points to a real handler.
- `ROUTE_TRUTH_TABLE.md` either matches `src/app.js` exactly or is explicitly retired with a banner pointing to `MAINTENANCE_FRONT_DOOR.md`.
- `npm run check:responses` and `npm run check:responses:changed` pass on the full repo (not only changed files), proving every JSON handler uses the envelope.
- `MOBILE_BACKEND_CONTRACT.md` matches what the routes actually accept (style on caption preview, top-level `shortId`/`finalize` on finalize, the real list of mounted mobile-used endpoints).
- `docs/DOCS_INDEX.md`, `MAINTENANCE_FRONT_DOOR.md`, and `FINAL_PAID_BETA_LAUNCH_PLAN.md` agree on a single "last verified" date and on which docs are canonical vs reference vs archive.
- Stale phase/audit docs at the repo root (`PRODUCTION_READINESS_AUDIT.md`, `BACKEND_AUDIT_PHASE1_PLAN.md`, `VAIFORM_REPO_COHESION_AUDIT.md`) are either updated to current truth, archived under `docs/archive/`, or removed — not left at root pretending to be live.
- The global error handler captures every 5xx to Sentry explicitly (today it relies entirely on `Sentry.setupExpressErrorHandler`); error envelopes never leak provider internals.
- A `/readiness` probe verifies Firebase Admin, Stripe, and the configured TTS provider can be reached at boot, distinct from the existing `/health` liveness probe.

### Out of scope
- Removing or renaming actual endpoints (compatibility-breaking moves should be their own work).
- Caption render parity (Track 3).
- Splitting large files (Track 4).
- Mobile-repo doc edits — only update the backend-owned bridge pointer here.

### Steps
1. **Inventory and reconcile.** Walk every mount in `src/app.js` and every router under `src/routes/`, produce the authoritative list, and rewrite `docs/API_CONTRACT.md` and `ROUTE_TRUTH_TABLE.md` against it. Add the missing story-edit endpoints, user-bootstrap endpoints, and admin/diag entries; remove anything documented but not implemented.
2. **Envelope cleanup.** Convert the manual `res.json` sites in `src/routes/diag.routes.js`, `src/routes/diag.headers.routes.js`, and the four `res.status(...).json(...)` sites in `src/routes/story.routes.js` to `respond.ok`/`respond.fail`. Keep deliberate non-JSON exceptions (file/static responses) untouched and document them in `COHESION_GUARDRAILS.md`.
3. **Mobile contract alignment.** Update `docs/MOBILE_BACKEND_CONTRACT.md` to reflect that caption preview accepts `style`, that finalize emits top-level `shortId`/`finalize` alongside `data`, and the real `requireAuth` placement on update-caption-meta. Refresh the verified date.
4. **Sentry capture made explicit.** In `src/middleware/error.middleware.js`, call `Sentry.captureException` for `>=500` errors (with the same redaction that `setupExpressErrorHandler` provides) so worker errors and out-of-Express errors are not lost when the Express handler chain is short-circuited.
5. **Readiness probe.** Add `GET /readiness` (and `/api/readiness`) that pings Firebase Admin (`auth().listUsers(1)` or a cheap doc read), Stripe (`stripe.balance.retrieve`), and the configured TTS provider with a 2 s timeout each. Keep `/health` as the cheap liveness check.
6. **Doc-set sync.** Update the verified-date headers across `DOCS_INDEX.md`, `MAINTENANCE_FRONT_DOOR.md`, and `FINAL_PAID_BETA_LAUNCH_PLAN.md` to a single date once the audit completes. Add a one-line "Other root-level audit docs are historical, see `docs/archive/`" pointer.
7. **CI gate widening.** Promote `npm run check:responses` (full scan) into `.github/workflows/ci.yml` so envelope drift cannot be re-introduced silently.

### Relevant files
- `src/app.js`
- `src/routes/index.js`
- `src/routes/diag.routes.js`
- `src/routes/diag.headers.routes.js`
- `src/routes/story.routes.js:101,448-454,1180,1480`
- `src/routes/admin.finalize.routes.js`
- `src/http/respond.js`
- `src/http/internal-error.js`
- `src/middleware/error.middleware.js`
- `instrument.mjs`
- `src/observability/finalize-observability.js`
- `docs/API_CONTRACT.md`
- `docs/MOBILE_BACKEND_CONTRACT.md`
- `docs/COHESION_GUARDRAILS.md`
- `docs/DOCS_INDEX.md`
- `docs/MAINTENANCE_FRONT_DOOR.md`
- `docs/FINAL_PAID_BETA_LAUNCH_PLAN.md`
- `docs/INCIDENT_TRACE_RUNBOOK.md`
- `docs/DEPLOY_ROLLBACK_HOTFIX_RUNBOOK.md`
- `ROUTE_TRUTH_TABLE.md`
- `PRODUCTION_READINESS_AUDIT.md`
- `BACKEND_AUDIT_PHASE1_PLAN.md`
- `VAIFORM_REPO_COHESION_AUDIT.md`
- `scripts/check-responses.js`
- `scripts/check-responses-changed.mjs`
- `.github/workflows/ci.yml`

---

## Track 3 — Caption Preview / Final Render Parity

### What & Why
The captioned preview and the final FFmpeg render currently produce different output for the same input. Concrete drifts found in code:

- `docs/caption/02-meta-contract-v3-raster.md` declares `yPx_png` is **top-left** and `yPct` is informational only, but `src/caption/renderCaptionImage.js` computes `yPct` from a **center anchor** (`textCenterY / canvasH`), and the preview route recomputes `yPx_png` with a centering formula. A long caption can shift by half its height between preview and final.
- The canonical builder `src/captions/compile.js` clamps `fontPx` to a fixed range and never auto-shrinks, while `renderCaptionImage.js` iteratively reduces font size to fit `SAFE_H` (80% of canvas). Same input ⇒ different output.
- `src/utils/ffmpeg.video.js` references hardcoded `/usr/share/fonts/...` paths that don't exist in this Replit environment, while `src/caption/canvas-fonts.js` looks under `assets/fonts`, `src/assets/fonts`, and `web/assets/fonts`. Final renders may silently substitute fonts.
- `src/render/overlay.helpers.js:102` throws when `rasterW >= 1080`, but 1080 is the exact frame width — a perfectly legal full-width caption errors out.
- `src/schemas/caption.schema.js` marks `lines/totalTextH/rasterW/rasterH/yPx_png` optional even though the contract doc lists them required.
- The route at `src/routes/caption.preview.routes.js:162` calls the canonical builder and then overwrites its output for `rasterH` and `yPx_png`, defeating the purpose of having a single builder.

This track makes the preview pixel-faithful to the final render so users see what they will actually get.

### Done looks like
- One builder owns caption metadata. The preview route, the preview renderer, and the FFmpeg overlay all consume the same `compile`-produced object without local recomputation.
- A single anchor convention is documented in `docs/caption/02-meta-contract-v3-raster.md` and enforced in code (top-left for `yPx_png`; `yPct` either removed or formally redefined to match).
- Font registration uses one resolver, with no hardcoded `/usr/share/fonts` paths. If a registered font fails to bind, the renderer raises a real error instead of silently falling back.
- The `rasterW >= 1080` guard is corrected to `rasterW > frameW` (or the bound is removed and the FFmpeg input is clamped properly).
- Schema for caption meta marks the contract-required fields as required; mobile callers continue to work.
- `npm run test:caption-preview-contract` and the parity script (`scripts/test-caption-parity.mjs` / `scripts/test-preview-render-parity.mjs`) succeed on a fixed corpus of short, medium, and long captions and on dark/light styles, and prove preview PNG and final-render frame agree within a documented tolerance.

### Out of scope
- Adding new caption features (animations, karaoke timing changes).
- Reworking video timeline assembly outside the caption overlay step.
- Mobile renderer changes beyond honoring whatever the backend now returns.

### Steps
1. **Lock the contract.** Pick top-left `yPx_png` as the single anchor (or center, but pick one). Update `docs/caption/02-meta-contract-v3-raster.md` and `docs/caption-meta-contract.md` to agree, and remove the contradictory pointer chain.
2. **Single builder authority.** Make `src/routes/caption.preview.routes.js` consume `compile.js` output verbatim — delete the local `rasterH`/`yPx_png` recomputation. If the builder is missing a field, add it inside `src/captions/compile.js`.
3. **Unify font resolution.** Have `src/utils/ffmpeg.video.js` get its font path from `src/caption/canvas-fonts.js` (export the resolved absolute path). Remove the `/usr/share/fonts/...` literals. Fail loudly when a required weight/style isn't registered.
4. **Fix the 1080 guard.** In `src/render/overlay.helpers.js`, change the throw condition from `>=` to strictly greater than the frame width, or remove the guard and add an FFmpeg-side clamp.
5. **Schema realignment.** Update `src/schemas/caption.schema.js` to require the fields the contract requires; coordinate with the mobile contract doc so the mobile shape stays compatible.
6. **Auto-shrink parity.** Either move the iterative font-size reduction into `compile.js` so both preview and final apply it, or remove it from the preview renderer so neither does. Document the choice.
7. **Pixel parity proof.** Refresh `scripts/test-caption-parity.mjs` and `scripts/test-preview-render-parity.mjs` to compare a handful of cases end-to-end and assert pixel diff under tolerance. Wire them into CI.

### Relevant files
- `src/captions/compile.js`
- `src/captions/constants.js`
- `src/caption/renderCaptionImage.js:88,126-131,215,253-256,292,331,350`
- `src/caption/canvas-fonts.js:19-20,40-41`
- `src/render/overlay.helpers.js:102,351-354,382,414,460-487`
- `src/routes/caption.preview.routes.js:113,134,154,162,191,212-221`
- `src/schemas/caption.schema.js`
- `src/utils/ffmpeg.video.js:515,527-528`
- `src/controllers/shorts.controller.js`
- `docs/caption/01-pipeline-overview.md`
- `docs/caption/02-meta-contract-v3-raster.md`
- `docs/caption/03-debugging-parity.md`
- `docs/caption-meta-contract.md`
- `docs/CAPTION_PREVIEW_RENDER_PARITY_PLAN.md`
- `scripts/test-caption-parity.mjs`
- `scripts/test-caption-preview-contract.mjs`
- `scripts/test-preview-render-parity.mjs`
- `assets/fonts/`

---

## Track 4 — Codebase Hygiene & Large-File Decomposition

### What & Why
The repo has accumulated drift that makes it harder than it should be for either a person or an agent to navigate it confidently:

- Five files at the repo root are each over 500 lines or are stale audit logs (`PRODUCTION_READINESS_AUDIT.md` 37k, `BACKEND_AUDIT_PHASE1_PLAN.md` 27k) sitting next to live code.
- `story-finalize.worker.js` and `story-preview.worker.js` exist at root **and** in `src/workers/` with different content. `package.json` runs the root entries; the inner versions are real implementations imported by the entries. The split is workable but every reader has to re-discover it.
- Five legacy test scripts at root (`test-font-fix.mjs`, `test-overlay-fixes.mjs`, `test-overlay-system.mjs`, `test-proxy.mjs`, plus `font-weight-test.png`, `download.jpg`, `generated-icon.png`) are not referenced by any current runner.
- `src/services/story.service.js` is **5,304 lines**, `src/utils/ffmpeg.video.js` is **3,011**, `src/services/story-finalize.attempts.js` is **2,255**, `src/routes/caption.preview.routes.js` is **2,001**, `src/routes/story.routes.js` is **1,937**. Files that long are effectively read-only for an LLM and dangerous to edit safely.
- `web/` is a full Tailwind frontend with its own `node_modules` (90 MB) that the repo's own `MAINTENANCE_FRONT_DOOR.md` already classifies as legacy / "remove later" — its disposition is undecided.
- `docs/_archive/` (127 files) and `docs/archive/` overlap and aren't cross-linked.
- `firebase-service-account.json` lives at the project root with a real private key. It is correctly gitignored (`.gitignore:143 *.json`), but a single accidental `git add -f` would leak production credentials.

This track is the cleanup pass that makes the next month of feature work cheaper and safer, without changing any runtime behavior.

### Done looks like
- One worker entry per worker, in one place. `package.json` scripts and `scripts/start-replit-runtime.mjs` point at the canonical files; the duplicates are gone.
- The five oversized files are split along clean seams (e.g. `story.service.js` into session, script, plan/search, sync, render-recovery sub-modules) with no behavior change. Public exports kept stable so callers do not need to be touched in the same task.
- Root-level `test-*.mjs`, throwaway PNGs/JPGs, and unreferenced audit `.md` files are either moved into `test/`, `attached_assets/`, or `docs/archive/` — or deleted.
- `web/` either gets a clear "this is the public marketing/admin web build, owned by X" status doc, or is moved out of the repo / archived. `web/node_modules` is no longer carried in the working tree.
- `firebase-service-account.json` is moved out of the project root into a path that is also gitignored, and `src/config/firebase.js` is updated to read it from there (or, better, from `GOOGLE_APPLICATION_CREDENTIALS`).
- `docs/_archive/` and `docs/archive/` are collapsed into one archive root with one `INDEX.md`.
- `npm run lint`, `npm test`, `npm run test:contracts`, `npm run check:responses`, and the Replit Run command all still work unchanged.

### Out of scope
- Behavior changes to any runtime path (this is purely structural).
- Doc-content rewrites (covered by Track 2).
- Caption renderer changes (covered by Track 3).
- Security or money-correctness fixes (covered by Track 1).

### Steps
1. **Worker consolidation.** Pick one location per worker (recommend `src/workers/`), absorb the root entry's `dotenv` + font-registration setup into it, update `package.json` and `scripts/start-replit-runtime.mjs`, and delete the duplicates. Verify with the existing finalize/preview observability tests.
2. **Decompose oversized files.** Split each of the five large files behind their existing public surface. Suggested seams:
   - `story.service.js` → `story.session.js` / `story.script.js` / `story.plan.js` / `story.search.js` / `story.sync.js` / `story.recovery.js`
   - `story-finalize.attempts.js` → `attempts.claim.js` / `attempts.settle.js` / `attempts.reap.js` / `attempts.metrics.js`
   - `caption.preview.routes.js` → `caption.preview.handler.js` (route file stays thin)
   - `story.routes.js` → group story-edit routes into one module, finalize/sync routes into another
   - `ffmpeg.video.js` → split filter-graph builder vs runner vs probe helpers
   Keep barrel exports so call sites do not need to change.
3. **Root cleanup.** Move `test-font-fix.mjs`, `test-overlay-fixes.mjs`, `test-overlay-system.mjs`, `test-proxy.mjs` into `test/legacy/` (or delete after confirming no caller). Move `download.jpg`, `font-weight-test.png`, `generated-icon.png` into `attached_assets/` or delete. Remove `npm-audit.json` (regenerable) and stale audit `.md` files into `docs/archive/`.
4. **Web directory disposition.** Decide one of: (a) keep `web/` as the active marketing/admin frontend and add an owner note, (b) extract it to its own repo, or (c) archive it. Whichever is chosen, `web/node_modules` should not be present in the working tree (add to `.gitignore` if not already, and remove on disk).
5. **Service-account file.** Move `firebase-service-account.json` to e.g. `.secrets/firebase-service-account.json` (gitignored), update `src/config/firebase.js` to look there, and document the recommended `GOOGLE_APPLICATION_CREDENTIALS` env-var path in `env.example`. Verify boot still works.
6. **Doc archive merge.** Pick one of `docs/_archive/` or `docs/archive/` as canonical, move the other in, write one `INDEX.md` that lists what's there and why it is not live truth.
7. **Verification pass.** Run lint, contracts, response-shape, security, and smoke scripts; re-run the Replit Run command; confirm `/health`, `/api/health`, and a representative finalize round-trip still work.

### Relevant files
- `package.json:27-30,49-56`
- `scripts/start-replit-runtime.mjs`
- `story-finalize.worker.js`
- `story-preview.worker.js`
- `src/workers/story-finalize.worker.js`
- `src/workers/story-preview.worker.js`
- `src/services/story.service.js`
- `src/services/story-finalize.attempts.js`
- `src/services/finalize-control.service.js`
- `src/utils/ffmpeg.video.js`
- `src/routes/story.routes.js`
- `src/routes/caption.preview.routes.js`
- `src/config/firebase.js`
- `firebase-service-account.json`
- `.gitignore:142-145`
- `env.example`
- `web/`
- `docs/_archive/`
- `docs/archive/`
- `PRODUCTION_READINESS_AUDIT.md`
- `BACKEND_AUDIT_PHASE1_PLAN.md`
- `VAIFORM_REPO_COHESION_AUDIT.md`
- `ROUTE_TRUTH_TABLE.md`
- `npm-audit.json`
- `download.jpg`
- `font-weight-test.png`
- `generated-icon.png`
- `test-font-fix.mjs`
- `test-overlay-fixes.mjs`
- `test-overlay-system.mjs`
- `test-proxy.mjs`
- `test/`
- `test/contracts/helpers/phase4a-harness.js`
- `test/observability/finalize-worker-runtime.test.js`
- `scripts/load/finalize-load-harness.mjs`
