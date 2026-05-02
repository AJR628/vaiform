# Backend Audit — Phase 1 Verified Commit Plan

**Status:** Phase 1 implementation in progress.
Commit 1 complete: `1c0b46f86009c3b0797d2974255ebe725b554993`.
Commits 2–5 pending explicit greenlight, one at a time.

**Scope:** The seven allowed focus areas only. Evidence comes from independent grep/read inspection of the current repo, not from the prior audit.
**Conservatism:** Where the original audit's recommendation conflicts with verified evidence, the verified evidence wins.

## Implementation progress

| Commit | Status | Commit SHA | Notes |
|---|---|---|---|
| Commit 1 — Remove placeholder Netlify origin from CORS allow-list | Complete | `1c0b46f86009c3b0797d2974255ebe725b554993` | Removed only the placeholder CORS origin from `src/app.js`. Verification passed: `rg` zero matches, lint green with pre-existing warnings, app import smoke green. |
| Commit 2 — Delete `src/controllers/health.controller.js` | Pending | — | Awaiting explicit greenlight. |
| Commit 3 — Remove `/api/limits` route | Pending | — | Awaiting explicit greenlight and caller re-check. |
| Commit 4 — Fix `assets.controller.js` `req.session`/`req.isPro` no-ops | Pending | — | Awaiting explicit greenlight. |
| Commit 5 — Delete or fix orphaned `image.fetch.js` | Pending | — | Awaiting explicit greenlight. |

---

## A. Verified findings summary

### A.1 Confirmed and should fix now (Phase 1)

| ID | Finding | Why pre-beta blocking |
|---|---|---|
| **F-CORS-1** | Placeholder `https://vaiform-user-name.netlify.app` in production CORS allow-list (`src/app.js:70`). | Trivial misconfig that ships a non-owned origin in the allow-list. Zero-risk to remove. |
| **F-LIMITS-1** | `/api/limits/usage` is mounted but multiple in-repo audit docs already flag it as a removal/retirement candidate (no current web or mobile caller). The handler also returns hardcoded plan caps that conflict with canonical `usage.service`. | Eliminates a divergent "second source of truth" before paid beta exposes the discrepancy to support tickets. Removing is lower-risk than re-implementing. |
| **F-HEALTH-1** | `src/controllers/health.controller.js` has zero importers anywhere in the repo; exposes `register` and `testFirestore` that write `users/{email}` (off-schema). | Code that violates the canonical `users/{uid}` schema and accepts unauthenticated `email` from a request body should not exist in the tree, even if currently unmounted. Deletion is provably safe (no importers). |
| **F-ASSETS-1** | `src/controllers/assets.controller.js` reads `req.session[...]` and `req.isPro`; no session middleware is mounted; `req.isPro` is never set. The dedupe is a silent no-op. | Active POST route (`/api/assets/options`); silently broken behavior is worse than no behavior. Fix is small, local, and reversible. |
| **F-IMAGE-1** | `src/utils/image.fetch.js` calls raw `fetch(url, {redirect:'follow'})` bypassing `assertPublicOutboundUrl`. **Important new evidence**: `fetchImageToTmp` has zero callers in `src/`. So today's exploitability is nil, but the function exists and a future caller would inherit the SSRF gap. | Lowest risk choice is to **delete the file** (zero callers). If we want to keep the helper available, second-best is to rewrite it on top of `outbound.fetch`. Either way, evidence-backed and safe. |

### A.2 Confirmed but should defer (not Phase 1)

| ID | Finding | Why deferred |
|---|---|---|
| **D-RL-1** | Add a conservative global rate limiter on auth-bootstrap routes (`/api/users/ensure`, `/api/checkout/start`). | `express-rate-limit` is already in deps and is **already used** by `src/routes/caption.preview.routes.js:5,92`. So the "completely unused" framing in the prior audit is wrong. Adding limiters elsewhere is reasonable but is a behavior change that needs Sentry/observability planning, an explicit `trust proxy` review, and a per-route allow-list. Defer to Phase 2. |
| **D-STRIPE-1** | Make Stripe webhook identity resolution fail closed when `subscription.metadata.uid` is missing. | **Important new evidence**: `src/controllers/checkout.controller.js:48-61` already sets `metadata.uid` on both the Checkout `session` and `subscription_data.metadata`. So all subscriptions created via this codebase have `subscription.metadata.uid`. The risk only applies to subscriptions created before this code shipped. Failing closed could break renewals/cancellations for those legacy subs. Phase 1 should only add **observability** (log a WARN when the webhook falls through to email/customer lookup); make the closed-fail change after one billing cycle of zero WARN occurrences. Out of Phase 1 scope per the user's "billing changes require tests + explicit approval" rule. |

### A.3 Inconclusive — needs more investigation

| ID | Finding | What's missing |
|---|---|---|
| **I-ASSETS-2** | Whether the original assets dedupe was ever a real product requirement, or carry-over from a prior session-cookie design. | The user's hard exclusion forbids "Firestore-backed asset dedupe", which strongly suggests the dedupe was vestigial. Confirm with product owner before deciding *what* to fix in F-ASSETS-1 (silent removal vs. authenticated note in response). |
| **I-RL-2** | What's the actual paid-beta traffic profile and IP-source-of-truth (single load balancer vs. direct Replit edge) needed to set `trust proxy` correctly for any future global limiter. | Required before D-RL-1 can be implemented safely. |

### A.4 Not valid / do not act on

| ID | Original claim | Why invalid |
|---|---|---|
| **N-1** | "limits.controller reads `users/{uid}/generations` subcollection that has no writers — dead query." | The collection is intentionally empty under the new architecture; the read returns 0 every time, so the controller's hardcoded cap is the *only* signal it ever produces. The fix is to remove the route entirely (F-LIMITS-1), not to add writers or "fix" the query. Listing it as a P3 dead-query item misframes the issue. |
| **N-2** | "express-rate-limit is in deps but no `app.use(rateLimit(...))` exists anywhere." | False. `caption.preview.routes.js:92` uses `previewRateLimit = rateLimit({...})`. The dependency is in active use, just not globally. |
| **N-3** | Mojibake placeholder string `Add textâ€¦` in `story.routes.js:1798-1801` should be cleaned up in Phase 1. | Out of scope (refactoring `story.routes.js` is a hard exclusion). Deferred. |
| **N-4** | `helmet({contentSecurityPolicy:false})` should be re-enabled in Phase 1. | Behavior change that affects every response and could break unforeseen `<script>` callers; needs a CSP design pass and rollout plan. Out of Phase 1 scope. |
| **N-5** | "Stripe webhook identity resolves via `getUserByEmail` — high risk." | Risk is real for *legacy* subscriptions only; the current checkout controller pins `metadata.uid`. Demoted from P1 to D-STRIPE-1 (observability-first). |

---

## B. Backend Audit Phase 1 — Commit Plan

> Rule: every commit is small, evidence-backed, and revertible by `git revert <sha>` with no follow-up cleanup. No commit refactors or restructures. No commit touches `story.service.js`, `story.routes.js`, `caption.preview.routes.js`, finalize/render/worker code, or billing behavior.

---

### Commit 1 — Remove placeholder Netlify origin from CORS allow-list

**Implementation status:** Complete in `1c0b46f86009c3b0797d2974255ebe725b554993`.

| Field | Value |
|---|---|
| **Goal** | Eliminate a non-owned placeholder origin from the production CORS allow-list. |
| **Files expected to change** | `src/app.js` (1 line removed, the comment on the same line). |
| **Files explicitly not to touch** | Anything in `src/routes/`, `src/controllers/`, `src/services/`, `src/middleware/`, `docs/`. |
| **Evidence** | `src/app.js:70` contains `'https://vaiform-user-name.netlify.app', // replace with your actual Netlify preview URL if used` — literal placeholder, not a real production origin. No grep match for this hostname elsewhere in the repo. |
| **Exact intended behavior change** | Remove the placeholder hostname from `ALLOWED_ORIGINS`. No other change to the CORS function. Real production origins (`https://vaiform.com`, `https://www.vaiform.com`) and dev `localhost` entries unchanged. Replit-preview wildcard (dev-only) unchanged. |
| **Test additions or updates** | None required. Optional: add a one-line assertion in a CI smoke that the literal `vaiform-user-name` does not appear in `src/app.js`. Not required for the commit. |
| **Verification commands** | `rg -n 'vaiform-user-name' src/` → expect zero matches after the commit. `node -e "require('./src/app.js')"` import smoke (or `npm run lint` if lint covers the file). |
| **Manual test steps** | From a browser at `https://vaiform.com`, issue a fetch to `/api/health` and confirm CORS headers are returned. From the Replit preview, repeat — should still work via the dev wildcard. |
| **Risk level** | Very low. The only way this could break anything is if some external system was actually using the placeholder URL, which is implausible. |
| **Rollback notes** | `git revert <sha>` restores the line. No data, no schema, no client-visible contract change. |
| **Docs to update** | None required. (No doc references the placeholder.) |

---

### Commit 2 — Delete `src/controllers/health.controller.js` (proven unused)

| Field | Value |
|---|---|
| **Goal** | Remove an unimported controller that violates the canonical `users/{uid}` schema and exposes an unauthenticated `register` write. |
| **Files expected to change** | Delete `src/controllers/health.controller.js`. |
| **Files explicitly not to touch** | `src/app.js` (the live `/health` endpoint is defined inline at `src/app.js:169-182` and does not reference `health.controller`). No route file, no service. |
| **Evidence** | `rg -n 'health\.controller\|healthController\|from.*health\.controller' src/` returns only the file's own self-comment line. No `import` of `register`, `testFirestore`, `healthz`, `version`, or `root` from this file anywhere. The live `/health` and `/api/health` endpoints are defined inline in `src/app.js:169-182` using `ok(req, res, ...)`. |
| **Exact intended behavior change** | None observable from outside. The runtime surface is unchanged because nothing routes to these handlers today. |
| **Test additions or updates** | None required. Existing observability/contract tests do not reference this file. |
| **Verification commands** | Before commit: `rg -n 'health\.controller' src/` → expect 1 match (the file itself). After commit: `rg -n 'health\.controller' src/` → expect 0 matches. `node -e "require('./src/app.js')"` import smoke. `curl -s http://localhost:3000/health` → expect canonical envelope response (unchanged). |
| **Manual test steps** | Start the API, hit `GET /health` and `GET /api/health`, confirm they still respond `{success:true,data:{service:'vaiform-backend',time:...},requestId:...}`. |
| **Risk level** | Very low. Provable zero importers. |
| **Rollback notes** | `git revert <sha>` restores the file. |
| **Docs to update** | Spot-check `docs/REPO_ARCHITECTURE_DIAGRAM.md` and `docs/ACTIVE_SURFACES.md` for any reference to `register`/`testFirestore` (none found in initial scan). If a stray reference exists, update in the same commit. |

---

### Commit 3 — Remove `/api/limits` route (no callers; divergent from canonical usage)

| Field | Value |
|---|---|
| **Goal** | Eliminate a route that returns a hardcoded plan-cap shape conflicting with the canonical seconds-based `usage.service`. Documented as a removal candidate; no current web or mobile caller. |
| **Files expected to change** | `src/app.js` (remove the `if (routes?.limits) { app.use('/api/limits', routes.limits); … }` block at lines 243-246). `src/routes/index.js` (remove the `import limitsRouter from './limits.routes.js';` and the `limits: limitsRouter,` entry). Delete `src/routes/limits.routes.js`. Delete `src/controllers/limits.controller.js`. |
| **Files explicitly not to touch** | `src/services/usage.service.js`, `src/controllers/usage.controller.js`, `src/routes/usage.routes.js` — these are the canonical `/api/usage` path and remain unchanged. |
| **Evidence** | `docs/LEGACY_WEB_SURFACES.md:46` ("no current mobile or `web/public` caller found … Remove after freeze."), `docs/MOBILE_BACKEND_CONTRACT.md:384` (`REMOVE_LATER` … "No current mobile caller; no current `web/public` caller"), `docs/TRUTH_FREEZE_AUDIT_2026-02-28.md:48` ("Delete candidate"). The handler hardcodes `monthlyGenerations: 10/250` (`src/controllers/limits.controller.js:33-46`) while the canonical truth is seconds-based via `getUsageSummary` (`src/services/usage.service.js:228`). Existing canonical surface `/api/usage` already serves the same intent (`src/controllers/usage.controller.js`). |
| **Exact intended behavior change** | `GET /api/limits/usage` now returns 404. `GET /api/usage` (canonical) is unchanged and remains the single source of truth. |
| **Test additions or updates** | If any existing test references `/api/limits/usage`, update or remove it. Initial grep of `test/` showed no such reference; verify before commit. Optional: add a one-line guard in `test/contracts/` that `GET /api/limits/usage` returns 404. |
| **Verification commands** | Before commit: `rg -n '/api/limits' src/ test/`, `rg -n 'limits' src/routes/index.js`. After commit: `rg -n 'limits\.routes\\|limits\.controller' src/` → expect zero matches. `curl -s -o /dev/null -w '%{http_code}' http://localhost:3000/api/limits/usage` → expect 404. `curl -s http://localhost:3000/api/usage -H 'Authorization: Bearer …'` → unchanged canonical response. |
| **Manual test steps** | Start API, confirm `/api/usage` works for an authenticated test user, confirm `/api/limits/usage` 404s. Spot-check the live mobile app or web app does not call `/api/limits/usage` (matches doc claim). |
| **Risk level** | Low **conditional on** confirming no live client calls the route. Multiple in-repo docs assert no callers, but cross-repo (mobile, marketing site) confirmation is a one-off pre-commit step (see Stop conditions §D). |
| **Rollback notes** | `git revert <sha>` restores files and the mount. Pure code change, no data migration. |
| **Docs to update** | `docs/ACTIVE_SURFACES.md:53,113` (remove `/api/limits/usage` from active list). `docs/LEGACY_WEB_SURFACES.md:46` (mark as removed with date). `docs/MOBILE_BACKEND_CONTRACT.md:384` (mark as removed). `docs/TRUTH_FREEZE_AUDIT_2026-02-28.md:48` (mark as removed). `docs/REPO_ARCHITECTURE_DIAGRAM.md:151,184` (remove from diagram). Do not touch archived audit docs under `docs/_archive/` or `docs/archive/`. |

---

### Commit 4 — Fix `assets.controller.js`: remove broken `req.session` dedupe and unset `req.isPro`

| Field | Value |
|---|---|
| **Goal** | Remove silently-broken behavior in an active POST route. Today the dedupe is a no-op (no session middleware) and `req.isPro` is permanently `false`. |
| **Files expected to change** | `src/controllers/assets.controller.js` only. |
| **Files explicitly not to touch** | `src/routes/assets.routes.js` (mount and validation chain unchanged), `src/schemas/quotes.schema.js`, `src/services/pexels.*` providers. Do **not** add a Firestore-backed dedupe (hard exclusion). Do **not** plumb a real `isPro` flag in this commit (out of scope; that's a planGuard work item). |
| **Evidence** | `rg -n 'req\.session' src/` → only matches in `src/controllers/assets.controller.js:30,31,85`. `rg -n 'req\.isPro\s*=' src/` → zero setters. `rg -n 'express-session\\|cookie-session' src/ package.json` → zero matches. Mount is active: `src/app.js:240-241` mounts `/api/assets` and `src/routes/assets.routes.js:9` exposes `POST /options` with `requireAuth` + `validate`. |
| **Exact intended behavior change** | (a) Delete the `req.session = req.session || {}; const seen = new Set(...)` block (lines 29-31). (b) Remove the `filtered = normalized.filter((it) => !seen.has(it.id))` and `seen.add` lines from both branches; return `normalized` directly. (c) Delete the `req.session[sessKey] = Array.from(seen).slice(-500);` line (85). (d) Replace `const isPro = req.isPro || false;` with `const isPro = false;` and add a one-line code comment that plan-aware paging will be plumbed via `usage.service` in a follow-up commit. The response shape (`{items,nextPage,meta,plan,limits}`) is unchanged in field set; `plan` will continue to be `'free'` (matches today's actual behavior). |
| **Test additions or updates** | Add a Node `--test` smoke under `test/contracts/` (new file `assets-options.contract.test.js`) that POSTs `/api/assets/options` with a stub Pexels provider, asserts the response envelope is canonical (`{success:true,data:{items,nextPage,meta,plan,limits},requestId}`) and that `plan === 'free'`. Provider stubbing pattern: import the controller and pass a mocked Pexels module (or run with a fake `PEXELS_API_KEY` and assert empty `items`). |
| **Verification commands** | Before commit: `rg -n 'req\.session\\|req\.isPro' src/`. After commit: `rg -n 'req\.session\\|req\.isPro' src/` → zero matches. `npm run lint` (covers `assets.controller.js` per `package.json:lint` line). `node --test test/contracts/assets-options.contract.test.js`. |
| **Manual test steps** | Authenticated `POST /api/assets/options` with `{type:'images',query:'sunset',perPage:12}` returns 200 with `data.items.length<=12`, `data.plan==='free'`, `data.limits.maxPerPage===12`. Repeat with `type:'videos'`. |
| **Risk level** | Low. The dedupe is provably already a no-op; `isPro` is provably already `false`. Removing the broken code preserves observable behavior and only deletes the no-ops. The response shape is unchanged. |
| **Rollback notes** | `git revert <sha>` restores the broken code. |
| **Docs to update** | None required; no docs describe the dedupe behavior. If `docs/ACTIVE_SURFACES.md` lists `/api/assets/options` (it does, line 52), no edit is needed because the surface continues to exist. |

---

### Commit 5 — Replace `src/utils/image.fetch.js` raw `fetch` with `fetchWithOutboundPolicy` (or delete file if confirmed orphan)

| Field | Value |
|---|---|
| **Goal** | Close the only SSRF bypass remaining among the outbound utilities, in the safest possible way. |
| **Files expected to change** | `src/utils/image.fetch.js` only. |
| **Files explicitly not to touch** | `src/utils/outbound.fetch.js`, `src/utils/video.fetch.js`, `src/utils/link.extract.js`, `src/utils/fetch.timeout.js`. |
| **Evidence** | `rg -n 'fetchImageToTmp\\|from.*image\\.fetch\\|require.*image\\.fetch' src/` returns only the file's own `export` lines. Zero callers in `src/`. The raw `fetch(url, {redirect:'follow', ...})` at line 16 bypasses `assertPublicOutboundUrl`. `outbound.fetch.js` exports `assertPublicOutboundUrl`, `fetchWithOutboundPolicy`, `readTextResponseWithLimit`, `isOutboundPolicyError` — known-good shims. `withAbortTimeout` (`src/utils/fetch.timeout.js`) is the existing timeout wrapper. |
| **Exact intended behavior change** | **Two options; choose option A unless the user explicitly wants to keep the helper:** **Option A (delete):** Delete `src/utils/image.fetch.js` entirely. Provably zero callers; no observable change. **Option B (rewrite):** Replace the inner `await fetch(url, {redirect:'follow', ...})` with `await fetchWithOutboundPolicy(url, { signal })` (or call `assertPublicOutboundUrl(url)` first then perform a single non-following fetch). Preserve the existing 8 MB cap and MIME allow-list (`image/jpeg|png|webp`). Preserve `withAbortTimeout(... { timeoutMs: 30000, errorMessage: 'IMAGE_DOWNLOAD_TIMEOUT' })` wrapper. Preserve the existing error codes (`IMAGE_URL_PROTOCOL`, `IMAGE_FETCH_${status}`, `IMAGE_TYPE`, `IMAGE_SIZE`). Default export shape unchanged. |
| **Test additions or updates** | If Option A: none. If Option B: add a Node `--test` smoke under `test/contracts/image-fetch.contract.test.js` that asserts (1) `https://10.0.0.1/x.jpg` rejects with an outbound-policy error code; (2) a redirect to `http://169.254.169.254/` is rejected; (3) protocol `http:` rejects with `IMAGE_URL_PROTOCOL`. Use a local `http.createServer` for the redirect case. |
| **Verification commands** | Before commit: `rg -n 'fetchImageToTmp' src/` → 2 matches (export + default export). After Option A: `rg -n 'image\.fetch\\|fetchImageToTmp' src/` → 0 matches. After Option B: `rg -n "fetch\(url" src/utils/image.fetch.js` → 0 matches; `rg -n "fetchWithOutboundPolicy\\|assertPublicOutboundUrl" src/utils/image.fetch.js` → ≥1 match. |
| **Manual test steps** | Option A: start API, run existing contract tests, confirm none import `image.fetch.js` (covered by grep above). Option B: run the new `image-fetch.contract.test.js` and confirm green. |
| **Risk level** | Very low. Provably zero callers today; either option is observably a no-op for current routes. |
| **Rollback notes** | `git revert <sha>` restores. |
| **Docs to update** | None. (No doc references `fetchImageToTmp`.) |

---

### (Out of Phase 1) Items deferred to Phase 2 with rationale

- **D-RL-1**: Add scoped `express-rate-limit` to `/api/users/ensure` and `/api/checkout/start`. Requires `trust proxy` review and Sentry alerting on `429` spikes; defer.
- **D-STRIPE-1**: Add observability-only commit logging when the webhook identity resolution falls through to `getUserByEmail`/`stripe.customers.retrieve`. After one billing cycle of zero such logs, change `resolveUid` to fail closed when `metadata.uid` is missing. Out of Phase 1 because billing changes require explicit approval per the user's rules.

---

## C. Recommended order

The order minimizes risk and lets each commit be reverted independently:

1. **Commit 1 (CORS placeholder removal)** — lowest-risk possible change; no behavior impact for any real origin. Establishes baseline that the change pipeline works end-to-end.
2. **Commit 2 (delete `health.controller.js`)** — provably zero importers; a clean prune that reduces the surface for future contributors to wire up wrong code.
3. **Commit 3 (remove `/api/limits` route)** — bigger blast radius than 1–2 because it changes a 200→404 for one URL, but documented as no-callers. Doing it after the trivial commits ensures any unforeseen 404 alert lands in isolation, not bundled with other changes.
4. **Commit 4 (`assets.controller` fix)** — touches an active route. Comes after the prunes so that if a regression appears in the assets endpoint we know it's from this commit, not from removed code.
5. **Commit 5 (`image.fetch.js` SSRF fix or delete)** — last because it's the only commit that touches a security utility. With prior commits green, any post-deploy alert isolates cleanly.

Each commit is independently revertible. No commit depends on a previous commit's runtime behavior.

---

## D. Stop conditions — halt and request human review

Stop and ask before proceeding if any of the following is observed during implementation:

1. **Commit 3 cross-repo check fails.** Before deleting `/api/limits/usage`, do a one-pass search of the mobile/client repo (if accessible) for `'/api/limits/usage'`. If any caller exists outside this backend repo, **stop** and ask whether to keep the route as a thin proxy to `getUsageSummary` instead of deleting it.
2. **Any commit's grep verification returns unexpected matches.** E.g. if `rg -n 'health\.controller' src/` after Commit 2 returns >0, stop — there is an importer we did not see.
3. **Lint/test failure on an unrelated file.** If `npm run lint` or `npm test` regresses on a file outside the commit's diff, stop and re-investigate (likely a hidden coupling).
4. **`req.session` or `req.isPro` referenced elsewhere.** If a future grep during Commit 4 reveals new usages we did not catch (initial grep showed only `assets.controller.js`), stop.
5. **`fetchImageToTmp` gains a caller during the commit window.** If anyone adds an import of `src/utils/image.fetch.js` between now and Commit 5, switch from Option A (delete) to Option B (rewrite) and re-verify.
6. **CORS placeholder turns out to be a real origin.** Vanishingly unlikely, but if `vaiform-user-name.netlify.app` does resolve to a Vaiform-owned environment, stop and replace with the real hostname instead of removing.
7. **Any doc-update step for Commit 3 reveals an undocumented client surface.** E.g. if `ACTIVE_SURFACES.md` says `/api/limits/usage` is mobile-active, stop and reconcile docs first.
8. **A user/product owner answer is needed for I-ASSETS-2.** If the team wants the dedupe to *exist* (just not via Firestore), stop Commit 4 and request a design decision before removing the no-op.

---

## E. Commit 1 implementation prompt (separate; do **not** implement yet)

> The following block is the prompt to feed back to the implementation agent **only when explicitly approved** to proceed with Commit 1.

```
Implement Backend Audit Phase 1 — Commit 1 only.

Task: Remove the placeholder Netlify origin from the CORS allow-list in
src/app.js.

Strict scope rules:
- Modify exactly one file: src/app.js.
- Make exactly one logical change: remove the array entry
  'https://vaiform-user-name.netlify.app' (and its trailing comment) from
  the ALLOWED_ORIGINS array.
- Do not modify any other line of src/app.js.
- Do not modify any other file in src/, scripts/, test/, docs/, or root.
- Do not add new dependencies.
- Do not add new tests in this commit.
- Do not change formatting elsewhere in the file.
- Preserve the surrounding entries exactly:
    'https://vaiform.com',
    'https://www.vaiform.com', // www subdomain
    'http://localhost:3000',
    'http://localhost:8888', // local development
- Preserve the existing isReplitPreview dev-only path and the corsOptions
  object exactly.

Pre-change verification:
1. Run: rg -n 'vaiform-user-name' src/   → expect exactly 1 match
   (src/app.js:70).
2. Read src/app.js lines 67-73 to confirm the entry to remove.

Post-change verification:
1. Run: rg -n 'vaiform-user-name' src/   → expect 0 matches.
2. Run: node -e "import('./src/app.js').then(()=>console.log('ok'))" or
   the project's existing import smoke; confirm no syntax errors.
3. Run: npm run lint   → expect green (src/app.js is in the lint scope per
   package.json scripts.lint).
4. Optionally: start the API workflow and curl /health to confirm the
   server still boots and responds with the canonical envelope.

Commit message (suggested):
    chore(cors): remove placeholder Netlify origin from allow-list

    The entry 'https://vaiform-user-name.netlify.app' was a literal
    placeholder ("replace with your actual Netlify preview URL if used")
    and is not a Vaiform-owned origin. No other reference to this
    hostname exists in the repo. No production or preview client uses it.

    Verification:
      rg -n 'vaiform-user-name' src/   # expect 0 matches
      npm run lint                     # green

Rollback:
    git revert <this commit's sha>   # restores the line and comment.

Stop and ask before proceeding if any pre- or post-change verification
step deviates from the expected result.
```

---

*End of plan. No source files were modified. Phase 1 commits 1–5 are ready for implementation in the order listed in §C, awaiting explicit approval.*
