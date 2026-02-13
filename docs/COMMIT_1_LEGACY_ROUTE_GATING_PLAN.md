# Commit 1: Gate Legacy Attack Surface — Audit and Plan

**Reference:** [VAIFORM_REPO_COHESION_AUDIT.md](../VAIFORM_REPO_COHESION_AUDIT.md) Cohesion Summary · [ACTIVE_SURFACES.md](ACTIVE_SURFACES.md)

---

## Audit

### 1) Active vs Legacy (from [ACTIVE_SURFACES.md](ACTIVE_SURFACES.md))

**Active (Article flow — production UI at /creative.html):**

- **Called by creative.article.mjs + caption-preview.js:**  
  `/api/story/*` (start, generate, plan, search, update-*, insert-beat, delete-beat, finalize, etc.), `/api/caption/preview`, `/api/story/update-caption-meta`, `/api/assets/options`.

**Legacy/orphan (no active frontend caller for Article flow):**

- **Mounted today:** `routes.voice` (/api/voice, /voice), `routes.tts` (/api/tts), `routes.uploads` (/api/uploads), `captionRenderRoutes` (/api/caption/render). Only `creative.legacy-quotes.mjs` (not loaded) would call these.
- **Not mounted (commented out):** `routes.studio` (/api/studio), `routes.quotes` (/api/quotes, /quotes).
- **Already disabled at handler level:** `routes.assets` POST /api/assets/ai-images returns 410.

**Other active surfaces:** Credits, checkout, generate, enhance, shorts (read), users, user, whoami, health, stripe webhook, cdn, creative page — all stay mounted regardless of ENABLE_LEGACY_ROUTES.

---

### 2) Mount map ([src/app.js](../src/app.js))

| Mount / handler       | Prefix(es)     | Condition today              |
|-----------------------|----------------|------------------------------|
| stripeWebhook         | /stripe/webhook| always                       |
| GET/HEAD /health, POST /diag/echo | inline | always                |
| healthRoutes          | /, /api        | always                       |
| whoamiRoutes          | /, /api        | always                       |
| creditsRoutes + getCreditsHandler | /, /api | always              |
| **diagRoutes**        | **/diag**      | **NODE_ENV !== "production"** |
| generateRoutes        | /, /api        | always                       |
| **diagHeadersRoutes** | **/api**       | **VAIFORM_DEBUG === "1"**    |
| routes.index, enhance, checkout, shorts | (various) | always |
| cdnRoutes             | /cdn           | always                       |
| **routes.uploads**    | **/api**       | always                       |
| routes.assets         | /api/assets    | always                       |
| routes.limits         | /api/limits, /limits | always                |
| **routes.voice**      | **/api/voice, /voice** | always              |
| routes.creative       | /creative      | always                       |
| **routes.tts**        | **/api/tts**   | always                       |
| routes.story          | /api/story     | always                       |
| captionPreviewRoutes  | /api           | always                       |
| **captionRenderRoutes** | **/api**     | always                       |
| userRoutes, usersRoutes | /api/user, /api/users | always           |
| routes.studio         | —              | commented out                |
| routes.quotes         | —              | commented out                |

---

### 3) Legacy routers to gate + uploads audit

**To gate behind `ENABLE_LEGACY_ROUTES=1`:**
- **routes.voice** — both app.use("/api/voice", …) and app.use("/voice", …).
- **routes.tts** — app.use("/api/tts", …).
- **routes.uploads** — app.use("/api", routes.uploads).
- **captionRenderRoutes** — app.use("/api", captionRenderRoutes).
- **routes.studio / routes.quotes** — For Commit 1 (maximal minimal-diff), leave **commented**. No new exposure when flag is set. To add in a later "legacy enablement" commit: use `if (ENABLE_LEGACY) app.use("/api/studio", routes.studio)` and `if (ENABLE_LEGACY) app.use("/api/quotes", routes.quotes)` **without** optional chaining (`routes?.studio`), so wiring errors surface.

**Audit step — routes.uploads mount shape:**  
Before gating, verify [src/routes/uploads.routes.js](../src/routes/uploads.routes.js) only defines paths under `/uploads/*`. Confirmed: router has only `r.post("/uploads/image", ...)` and `r.post("/uploads/register", ...)`. Mounted at `/api`, that yields only `/api/uploads/image` and `/api/uploads/register` — no other `/api/*` paths in that router. **Implementer should double-check no extra routes were added.**

**Not gated:** captionPreviewRoutes (Article uses POST /api/caption/preview). routes.assets (Article uses POST /api/assets/options; ai-images already 410 in handler).

---

### 4) Diag routes and current gating

| Item                    | Location          | Current behavior                    |
|-------------------------|-------------------|-------------------------------------|
| POST /diag/echo         | app.js inline     | Always mounted                      |
| diagRoutes (/diag/*)    | app.js            | NODE_ENV !== "production"            |
| diagHeadersRoutes       | app.js            | VAIFORM_DEBUG === "1"               |
| GET /api/diag/caption-smoke | caption.preview.routes.js | Handler 404 when VAIFORM_DEBUG !== "1" |

**Decision:** Unify all diag behind VAIFORM_DEBUG=1 (single policy). Document that dev tooling (e.g. web SPA TokenDrawer/AppShell calling `/diag/tts_state`) requires `VAIFORM_DEBUG=1`.

---

## Plan

### A. Add ENABLE_LEGACY_ROUTES (default 0)

- `const ENABLE_LEGACY = process.env.ENABLE_LEGACY_ROUTES === "1";` in [src/app.js](../src/app.js) near top (e.g. with DBG).

### B. Gate legacy router mounts in app.js

- Wrap voice, tts, uploads, captionRenderRoutes in `if (ENABLE_LEGACY) { ... }`. Do not use optional chaining for these (routes.voice etc. are real exports from index.js).
- **Commit 1:** Leave studio and quotes commented (maximal minimal-diff). To add later: `if (ENABLE_LEGACY) app.use("/api/studio", routes.studio)` and same for quotes, without `routes?.`.
- No changes to route handler implementations; only mount/no-mount in app.js.

### C. Gate diag behind VAIFORM_DEBUG=1

- **POST /diag/echo** — Wrap inline handler in `if (DBG) { ... }`.
- **diagRoutes** — Change from `NODE_ENV !== "production"` to `if (process.env.VAIFORM_DEBUG === "1") app.use("/diag", diagRoutes)`.
- **Doc requirement:** Document that any dev tooling that relies on diag requires `VAIFORM_DEBUG=1` (no NODE_ENV-based diag after unification).

### D. env.example and docs

- Add root `.env.example` (or `env.example`) with `ENABLE_LEGACY_ROUTES=0` and `VAIFORM_DEBUG=0` + short comments.
- In ACTIVE_SURFACES.md (and optionally README), add "Route gating" / "Environment" subsection describing both flags.

### E. Verification (hard checks)

- **With ENABLE_LEGACY_ROUTES=0 (default):**
  - Article flow: POST /api/story/start, POST /api/caption/preview, POST /api/assets/options (and other /api/story/*) return 200 or expected error, not 404.
  - Legacy: POST /api/voice/voices, POST /api/tts/preview, POST /api/uploads/register, POST /api/caption/render → 404.
  - Studio/quotes: GET/POST /api/studio/*, /api/quotes/* → 404.
- **Caption render vs story finalize (hard check):** Run a full **POST /api/story/finalize** render with **ENABLE_LEGACY_ROUTES=0** and confirm it completes successfully. Article pipeline burns captions in-process via `renderVideoQuoteOverlay` (ffmpeg.video.js); it does not call the HTTP endpoint `/api/caption/render`. **This check proves that gating captionRenderRoutes does not break finalize.**
- **With VAIFORM_DEBUG=0 (or unset):** POST /diag/echo and /diag/* return 404 when diag is not mounted.
- **Frontend:** Load /creative; no new console errors; story, caption preview, assets/options continue to work.

### F. 404 only — no "disabled" middleware

- **Commit 1:** Unmount legacy routes only; they hit the existing 404. Do **not** add new middleware or a "legacy disabled" JSON response. (If added later, it would be a single handler — out of scope for this commit.)

---

## Summary

| Change               | Where   | What                                                                 |
|----------------------|---------|----------------------------------------------------------------------|
| ENABLE_LEGACY_ROUTES | app.js  | Const; wrap voice, tts, uploads, captionRender mounts (studio/quotes stay commented) |
| Diag                 | app.js  | Gate POST /diag/echo and /diag router on VAIFORM_DEBUG=1             |
| env.example          | repo root | ENABLE_LEGACY_ROUTES=0, VAIFORM_DEBUG=0 + comments                |
| Docs                 | ACTIVE_SURFACES.md / README | Route gating and diag tooling (VAIFORM_DEBUG=1)        |

**No behavior change** for Active routes. No changes to ffmpeg.video.js or other fragile files.
