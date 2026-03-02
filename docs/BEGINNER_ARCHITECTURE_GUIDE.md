# Vaiform Repo: Architecture for Builders (Beginner-Friendly)

This guide explains **how this codebase is built** so you can see how routes, middleware, idempotency, and responses fit together—even if you’re new to code. No code changes here; this is a **read-only audit and breakdown**.

---

## 1. The Big Picture: What Happens When a Request Comes In

Think of the backend as a **pipeline**. A request (e.g. “create a short” or “get my credits”) enters at one end and a response leaves at the other. In between, it passes through **layers** in a fixed order:

```
  [Client]  →  [App: global middleware]  →  [Route + route middleware]  →  [Controller]  →  [Response]
```

- **App** (`src/app.js`) is the single entry. It sets up security (helmet, CORS), assigns a **request ID**, and parses JSON for most paths.
- **Routes** are “mount points”: a URL path like `/api/generate` or `/api/story/finalize` is tied to a **router** that defines which **middleware** and **controller** run for that path.
- **Middleware** are small functions that run **before** (or around) the main handler. They can:
  - **Auth**: check the user is signed in (`requireAuth`).
  - **Validation**: check the body shape (`validate(schema)`).
  - **Idempotency**: make “same request twice” safe (no double charge, no duplicate work).
  - **Guards**: e.g. “has enough credits,” “has a render slot,” “within daily cap.”
- **Controller** (or “handler”) is the function that does the real work (call services, read/write DB, call external APIs) and sends the response.

So: **route** = “for this URL, run this list of middleware, then this controller.” The repo is built by **composing** these pieces in a consistent order.

---

## 2. Where Things Live (File Map)

| What                 | Where                                                         | Purpose                                                                                                                                     |
| -------------------- | ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| **App entry**        | `src/app.js`                                                  | Creates the Express app, mounts global middleware (reqId, CORS, JSON parser), then mounts every **route** under a path.                     |
| **Routes**           | `src/routes/*.routes.js` (and a few like `stripe.webhook.js`) | Each file is a **router**: it says “for POST /generate do: requireAuth → idempotency → validate → generate.”                                |
| **Route index**      | `src/routes/index.js`                                         | Exports all routers as one object; `app.js` imports some routers from here and some directly.                                               |
| **Middleware**       | `src/middleware/*.js`                                         | Reusable pieces: `reqId`, `requireAuth`, `validate`, `idempotency.firestore`, `planGuards`, `error.middleware`.                             |
| **Response helpers** | `src/http/respond.js`                                         | `ok(req, res, data)` and `fail(req, res, status, error, detail, fields)` so every JSON response uses the same envelope.                     |
| **Error handler**    | `src/middleware/error.middleware.js`                          | Last middleware in the app; catches any thrown error and turns it into a canonical `{ success: false, error, detail, requestId }` response. |
| **Controllers**      | `src/controllers/*.js`                                        | Functions that perform the action (e.g. `generate`, `jobStatus`, `createCheckoutSession`).                                                  |
| **Schemas**          | `src/schemas/*.schema.js`                                     | Zod schemas used by `validate(...)` to check request body shape.                                                                            |
| **Services**         | `src/services/*.js`                                           | Business logic (credits, story, shorts, storage, etc.); controllers call them.                                                              |

**SSOT (single source of truth) docs** that describe what’s _allowed_ and _current_:

- **Routes/surfaces**: `ROUTE_TRUTH_TABLE.md`, `docs/ACTIVE_SURFACES.md`
- **How to add routes / middleware order**: `docs/COHESION_GUARDRAILS.md`
- **Repo posture / API contract**: `PLAN_UPDATED_WITH_STATUS_LEDGER.md`, `VAIFORM_REPO_COHESION_AUDIT.md`

---

## 3. How Routes Are Mounted (Order Matters)

In `src/app.js`, the order of `app.use(...)` and `app.get/post(...)` is **intentional**:

1. **Trust proxy** and **helmet** (security).
2. **reqId** – assign `req.id` and `X-Request-Id` header for every request.
3. **Stripe webhook** at `/stripe/webhook` – mounted **before** the global JSON body parser so Stripe gets **raw** body for signature verification.
4. **Conditional 200kb JSON** for specific paths (e.g. caption preview), then **global JSON** (10mb) for the rest.
5. **Optional debug logging** (only if `VAIFORM_DEBUG=1`).
6. **Trailing-slash redirect** for GET (non-API) paths.
7. **Health** – `GET/HEAD /health` and `GET/HEAD /api/health` (inline).
8. **Static assets** – `GET /assets/*` (fonts, etc.) served from `assets/`.
9. **API routers** – all under `/api` (and `/diag` when debug is on):
   - `app.use('/api', generateRoutes)` → POST `/api/generate`, GET `/api/job/:jobId`
   - `app.use('/api/whoami', whoamiRoutes)`
   - `app.use('/api/credits', creditsRoutes)`
   - `app.use('/api/checkout', routes.checkout)` → `/api/checkout/start`, `/session`, `/subscription`, `/portal`
   - `app.use('/api/shorts', routes.shorts)`
   - `app.use('/api/assets', routes.assets)`
   - `app.use('/api/limits', routes.limits)`
   - `app.use('/api/story', storyRouter)` → many story endpoints including `/api/story/finalize`
   - `app.use('/api/caption/preview', ...)`
   - `app.use('/api/user', userRoutes)`
   - `app.use('/api/users', usersRoutes)`
10. **Error handler** – last; catches any unhandled error and responds with the canonical failure envelope.

So: **mount order** in `app.js` defines **which path wins** when two could match, and **which middleware** (e.g. JSON or raw body) a request sees first.

---

## 4. Middleware: What It Is and the Standard Order

**Middleware** is a function `(req, res, next) => { ... }`. It can:

- **Inspect or modify** `req` (e.g. set `req.user` after verifying the JWT).
- **Short-circuit** by sending a response (`res.status(400).json(...)`) and **not** calling `next()`.
- **Continue** by calling `next()` so the next middleware or the final controller runs.
- **Wrap the response** (e.g. idempotency overrides `res.json` to store the result before sending).

The repo uses a **standard order** for secured, mutating JSON endpoints (documented in `docs/COHESION_GUARDRAILS.md`):

```
reqId  →  CORS  →  requireAuth  →  plan guards (if any)  →  idempotency (if any)  →  validate  →  controller
```

- **reqId** and **CORS** are applied **globally** in `app.js`, so every request gets them first.
- **requireAuth** is applied **per route** (or per router with `r.use(requireAuth)`). It reads `Authorization: Bearer <token>`, verifies with Firebase, and sets `req.user = { uid, email }`; if missing/invalid it responds with 401 and does not call `next()`.
- **Plan guards** (from `src/middleware/planGuards.js`) enforce things like “user has enough credits” or “within daily short limit.” Used on story/shorts routes.
- **Idempotency** (see next section) is added only on routes that must not double-execute (e.g. charge twice, render twice).
- **validate(schema)** runs Zod so `req.body` is validated and parsed into `req.valid`; on failure it responds 400 with `fields` and does not call `next()`.
- **Controller** is the last function; it uses `req.user`, `req.valid` (or `req.body`), and calls services, then sends the response via `ok()` or `fail()`.

**Example with all of them** – `src/routes/generate.routes.js`:

```text
r.post('/generate', requireAuth, idempotency(), validate(GenerateSchema), generate);
```

So for `POST /api/generate` (because this router is mounted at `/api`), the order is: requireAuth → idempotency() → validate(GenerateSchema) → generate controller.

**Example without idempotency or plan guards** – `src/routes/checkout.routes.js`:

```text
router.post('/session', requireAuth, validate(checkoutSessionSchema), createCheckoutSession);
```

Here the chain is: requireAuth → validate → controller. No idempotency (Stripe handles idempotency on their side for payment intents).

---

## 5. Idempotency: What It Is and Where It’s Used

**Idempotency** means: “If the client sends the **same request twice** (e.g. double-click or retry), the server should **not** do the action twice.” For example:

- **Charge credits once** – same idempotency key twice → first request runs the job and charges; second request returns the **same result** without charging again.
- **Render once** – same key twice → first finalizes and renders; second returns the same short without rendering again.

**How it’s implemented** in this repo:

- **Module**: `src/middleware/idempotency.firestore.js`
- **Storage**: Firestore collection `idempotency`, document id `{uid}:{key}` where `key` is the client-supplied `X-Idempotency-Key` header.
- **Two variants**:
  1. **`idempotency()`** (default export) – used for **POST /api/generate**. Creates a “pending” doc; when the handler calls `res.json(body)`, the middleware stores “done” and the response body so a replay can return the same body. Does not reserve credits; used for legacy image generation.
  2. **`idempotencyFinalize({ getSession, creditCost })`** – used for **POST /api/story/finalize**. Requires `X-Idempotency-Key` and a valid `sessionId`. In one transaction it creates the idempotency doc in “pending” and **debits credits** (reserve). On success it stores only minimal payload (shortId, sessionId); on 5xx it **refunds** and cleans up. Replay returns the same success shape without re-running render or charging again.

**Where it’s used (evidence):**

| Route                    | File:line                            | Middleware                                                                             |
| ------------------------ | ------------------------------------ | -------------------------------------------------------------------------------------- |
| POST /api/generate       | `src/routes/generate.routes.js:11`   | `idempotency()`                                                                        |
| POST /api/story/finalize | `src/routes/story.routes.js:768-770` | `idempotencyFinalize({ getSession: getStorySession, creditCost: RENDER_CREDIT_COST })` |

CORS is configured to allow the header: `allowedHeaders: [..., 'x-idempotency-key']` in `src/app.js`.

**How you know where to add idempotency**

- **Add it on any POST (or mutating) endpoint where:**
  - The action is **expensive** (credits, render, external API), and
  - The client might **retry** or **double-submit** (e.g. “Finalize” button, “Generate” button).
- **Standard place in the chain:** after auth and plan guards, **before** validate and controller (so the middleware can read `req.user` and optionally `req.body` to validate before reserving).
- **Client must send** `X-Idempotency-Key` (e.g. a UUID per user action). If the route requires it, the middleware returns 400 when the header is missing.
- **Docs:** `docs/COHESION_GUARDRAILS.md` “Standard Middleware Order” and “Adding/Changing Routes” say: use idempotency “if applicable” and keep the order: `requireAuth → plan guards → idempotency → validate → controller`.

So: **routes that charge credits or do one-time heavy work** are the ones that get idempotency; **read-only or Stripe-backed payment** routes typically don’t use it in this repo.

---

## 6. How Responses and Errors Are Standardized

- **Success:** `ok(req, res, data)` in `src/http/respond.js` sends `{ success: true, data, requestId }` with status 200.
- **Failure:** `fail(req, res, status, error, detail, fields)` sends `{ success: false, error, detail, requestId, fields? }` with the given status.
- **Request ID:** Set by `reqId` middleware (`req.id`); used in every response so logs and clients can correlate.
- **Errors:** If any middleware or controller throws (or calls `next(err)`), the **error handler** (`src/middleware/error.middleware.js`) runs last. It maps known error types (e.g. Zod, 401, 403, Stripe signature) to status codes and always responds with the **canonical failure envelope** via `fail(...)`.

So: **all JSON APIs** are supposed to use `ok`/`fail` and the same envelope; the SSOT for that contract is `src/http/respond.js` and `docs/API_CONTRACT.md` (and plan/ledger docs).

---

## 7. How It All Ties Together (One Request Example)

**Example: POST /api/story/finalize** (user clicks “Finalize” to render a short)

1. **Netlify** (in production) proxies `/api/*` to the backend; the request hits the Express app.
2. **app.js**: reqId runs → CORS → body is already parsed as JSON (so `req.body` exists). Request does **not** hit the Stripe webhook path, so it goes through the normal JSON pipeline.
3. **app.js**: No match for `/health` or `/assets`; request reaches `app.use('/api', ...)` and then the **story** router is matched for `/api/story/*`, so `story.routes.js` handles it.
4. **story.routes.js**: Router has `r.use(requireAuth)`, so **requireAuth** runs first → verifies Bearer token, sets `req.user`.
5. **story.routes.js**: For `POST /finalize`, the chain is:
   - **idempotencyFinalize(...)** – checks `X-Idempotency-Key` and `sessionId`; if replay (doc already “done”), loads session via `getSession` and returns same success shape; if new, in a transaction creates idempotency doc “pending” and **debits credits** (reserve); then calls `next()`.
   - **Controller** (inline async function) – parses body with SessionSchema, calls `withRenderSlot(() => finalizeStory(...))` (render slot + actual render). On success, responds with `finalizeSuccess(req, session, shortId)`.
   - **idempotencyFinalize** wrapped around the response: on success it marks the idempotency doc “done” with minimal payload; on 5xx it refunds credits and cleans up.
6. **Response** is sent with `{ success: true, data: session, shortId, requestId }`.
7. If anything throws, **error handler** runs and sends `{ success: false, error, detail, requestId }` with the appropriate status.

So: **route** (mount + path) → **middleware chain** (auth → idempotency → validate → controller) → **response** (ok/fail or error handler). Idempotency sits in the chain where it can reserve/refund credits and replay previous results.

---

## 8. Quick Reference: Where to Look for What

| Goal                              | Where to look                                                                                          |
| --------------------------------- | ------------------------------------------------------------------------------------------------------ |
| List of all API paths and methods | `ROUTE_TRUTH_TABLE.md`, `docs/ACTIVE_SURFACES.md`                                                      |
| How to add or change a route      | `docs/COHESION_GUARDRAILS.md` (middleware order, validation, envelope, route truth docs)               |
| Which routes use idempotency      | `src/routes/generate.routes.js`, `src/routes/story.routes.js` (finalize); grep `idempotency` in `src/` |
| Where a path is mounted           | `src/app.js` (search for the path or router name)                                                      |
| What middleware a route uses      | Open the corresponding `src/routes/*.routes.js` and read the chain for that method/path                |
| Response shape (success/failure)  | `src/http/respond.js`; `docs/API_CONTRACT.md`                                                          |
| Frontend calling which API        | `docs/ACTIVE_SURFACES.md` “Caller-backed notes”; `web/public/**` for actual call sites                 |

---

## 9. Summary

- **Architecture**: One Express app in `src/app.js`; global middleware first (reqId, CORS, body parsing), then mounts for webhook, health, assets, and **all API routers** under `/api`. Order of mounts and order of middleware in each route both matter.
- **Routes**: Each `src/routes/*.routes.js` defines a **chain**: auth → optional plan guards → optional idempotency → validate → controller. Controllers call **services** and respond with **ok**/ **fail**.
- **Middleware**: Reusable steps (auth, validation, idempotency, plan guards) composed in a **standard order**; idempotency is only on endpoints that must not double-charge or double-execute.
- **Idempotency**: Implemented in `src/middleware/idempotency.firestore.js`; used on **POST /api/generate** and **POST /api/story/finalize**. You add it where a retry or double-submit would be harmful (e.g. spending credits or rendering twice), and you keep the chain order and document the route in the SSOT docs.

Understanding “where is this route mounted,” “what middleware runs in what order,” and “where does idempotency apply” gives you the map to follow or change any behavior in this codebase.
