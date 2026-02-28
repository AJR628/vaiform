# Vaiform Repo Architecture — Visual Diagram

This document is a **visual map** of how the repo is structured and what talks to what. It does not change any code; it reflects the current state of the repo for reasoning and scoping.

---

## 1. The Five Layers (Mental Model)

Think of Vaiform as **5 layers**. Keeping them separate makes the repo easier to reason about.

```mermaid
flowchart TB
  subgraph L1["Layer 1: Page shell + script boot"]
    HTML["creative.html"]
    ScriptOrder["Script load order: firebaseClient → auth-bridge → credits-ui → creative.article.mjs"]
  end

  subgraph L2["Layer 2: Frontend pipeline orchestrator"]
    Article["creative.article.mjs"]
    CaptionPreview["caption-preview.js (dynamic import)"]
  end

  subgraph L3["Layer 3: API transport / auth glue"]
    ApiMjs["api.mjs"]
    AuthBridge["auth-bridge.js"]
    FirebaseClient["firebaseClient.js"]
  end

  subgraph L4["Layer 4: Backend route + middleware chain"]
    App["src/app.js"]
    RoutesIndex["src/routes/index.js"]
    StoryRoutes["story.routes.js"]
    CaptionRoutes["caption.preview.routes.js"]
    ShortsRoutes["shorts.routes.js"]
  end

  subgraph L5["Layer 5: Services + storage / external"]
    StorySvc["story.service.js"]
    CreditSvc["credit.service.js"]
    Idempotency["idempotency.firestore.js"]
    Storage["Firebase Storage (drafts, artifacts)"]
    Firestore["Firestore (users, shorts, idempotency)"]
  end

  HTML --> ScriptOrder
  ScriptOrder --> Article
  Article --> ApiMjs
  AuthBridge --> ApiMjs
  FirebaseClient --> AuthBridge
  ApiMjs --> App
  App --> RoutesIndex
  RoutesIndex --> StoryRoutes
  StoryRoutes --> StorySvc
  StorySvc --> Storage
  StorySvc --> Firestore
  Article --> CaptionPreview
  CaptionPreview --> CaptionRoutes
  StoryRoutes --> ShortsRoutes
```

---

## 2. Page Shell Boot Order (Creative Page)

**Entry shell:** `web/public/creative.html`

Script load order matters. The following is the effective order (creative.html and how modules pull in dependencies):

```mermaid
sequenceDiagram
  participant HTML as creative.html
  participant FC as js/firebaseClient.js
  participant AB as auth-bridge.js
  participant CU as js/credits-ui.js
  participant API as api.mjs
  participant Article as js/pages/creative/creative.article.mjs

  HTML->>FC: load (module)
  HTML->>AB: load (module)
  HTML->>CU: load (module)
  Note over AB: Wires Firebase auth into API token provider
  HTML->>Article: load (module)
  Article->>API: dynamic import when calling API
  Note over API: Adds /api prefix, attaches token, normalizes errors
```

| Order | File                                                | Role                                                                         |
| ----- | --------------------------------------------------- | ---------------------------------------------------------------------------- |
| 1     | `web/public/js/firebaseClient.js`                   | Firebase app/auth/db; `ensureUserDoc()` → `/api/users/ensure`                |
| 2     | `web/public/auth-bridge.js`                         | Connects Firebase auth to api.mjs token provider; reacts to auth changes     |
| 3     | `web/public/js/credits-ui.js`                       | Credits display; `updateCreditsDisplay`, `fetchAndUpdateCredits`             |
| 4     | `web/public/js/pages/creative/creative.article.mjs` | Main UI pipeline (state, API calls, captions, storyboard, finalize, polling) |

**Important:** `api.mjs` is not a top-level script in creative.html; `creative.article.mjs` (and caption-preview) dynamically import it when making requests. If script order or globals change, routes can appear broken without any backend change.

---

## 3. Frontend API / Auth Glue (Hidden Support Beams)

```mermaid
flowchart LR
  subgraph Frontend["Frontend"]
    Article["creative.article.mjs"]
    CaptionPreview["caption-preview.js"]
  end

  subgraph Glue["API / auth glue"]
    ApiMjs["api.mjs"]
    AuthBridge["auth-bridge.js"]
    FirebaseClient["firebaseClient.js"]
  end

  Article -->|"apiFetch()"| ApiMjs
  CaptionPreview -->|"apiFetch()"| ApiMjs
  AuthBridge -->|"setTokenProvider()"| ApiMjs
  FirebaseClient -->|"auth instance"| AuthBridge
  ApiMjs -->|"All /api/* requests"| Backend["Backend /api/*"]
```

| File                  | Responsibility                                                                                                                                     |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| **api.mjs**           | Transport: adds `/api` prefix, attaches auth token, normalizes errors; exposes `apiFetch()`. Most frontend code does not know backend URL details. |
| **auth-bridge.js**    | Auth bridge: connects Firebase auth to API token provider; ensures user record on first login.                                                     |
| **firebaseClient.js** | Firebase client: initializes app/auth/db; `ensureUserDoc()` calls `/api/users/ensure`.                                                             |

---

## 4. Backend Route + Middleware Chain

**App entry:** `server.js` → `src/app.js`

### 4.1 App mount order (src/app.js)

```mermaid
flowchart TB
  subgraph Order["Mount order (simplified)"]
    A["reqId"]
    B["CORS"]
    C["/stripe/webhook (raw)"]
    D["JSON 200kb for /api/caption/preview"]
    E["express.json 10mb"]
    F["/health, /api/health"]
    G["/assets static"]
    H["/api: generate, whoami, credits, diag(debug)"]
    I["/api/checkout, /api/shorts, /api/assets, /api/limits, /api/story"]
    J["/api → caption.preview.routes"]
    K["/api/user, /api/users"]
    L["errorHandler"]
  end
  A --> B --> C --> D --> E --> F --> G --> H --> I --> J --> K --> L
```

### 4.2 API route registry (src/routes/index.js)

This is the **backend route map** to read before touching any feature.

```mermaid
flowchart LR
  Index["src/routes/index.js"]
  Index --> Credits["credits"]
  Index --> Whoami["whoami"]
  Index --> Generate["generate"]
  Index --> Webhook["stripe.webhook"]
  Index --> Checkout["checkout"]
  Index --> Diag["diag"]
  Index --> Shorts["shorts"]
  Index --> Assets["assets"]
  Index --> Limits["limits"]
  Index --> Story["story"]
```

| Mount in app.js | Path            | Router source                                        |
| --------------- | --------------- | ---------------------------------------------------- |
| (direct)        | `/api`          | generate.routes.js → POST /generate, GET /job/:jobId |
| (direct)        | `/api/whoami`   | whoami.routes.js                                     |
| (direct)        | `/api/credits`  | credits.routes.js                                    |
| (direct)        | `/api/checkout` | checkout.routes.js                                   |
| (direct)        | `/api/shorts`   | shorts.routes.js                                     |
| (direct)        | `/api/assets`   | assets.routes.js                                     |
| (direct)        | `/api/limits`   | limits.routes.js                                     |
| (direct)        | `/api/story`    | story.routes.js                                      |
| (direct)        | `/api`          | caption.preview.routes.js → POST /caption/preview    |
| (direct)        | `/api/user`     | user.routes.js                                       |
| (direct)        | `/api/users`    | users.routes.js                                      |

**Note on drift:** If you ever see references to `./routes/index.routes.js`, `./middleware/requestLogger.js`, `./config/cors.js`, `./config/helmet.js`, `./middleware/session.middleware.js`, or `./middleware/limits.middleware.js` in app.js, that is the “old” mental model. The current repo uses `./routes/index.js`, inline CORS/helmet in app.js, `reqId.js`, `error.middleware.js`, etc. Keeping app.js and this diagram in sync avoids two mental models.

---

## 5. Story / Shorts Pipeline (Idea → Render → Status)

End-to-end chain from UI to storage and back.

```mermaid
flowchart TB
  subgraph UI["Frontend"]
    Article["creative.article.mjs"]
  end

  subgraph API["API layer"]
    StoryRoutes["story.routes.js"]
    ShortsRoutes["shorts.routes.js"]
  end

  subgraph Service["Service layer"]
    StorySvc["story.service.js"]
  end

  subgraph Helpers["Helpers / providers"]
    StoryLLM["story.llm.service.js"]
    Pexels["pexels.videos.provider.js"]
    Pixabay["pixabay.videos.provider.js"]
    Nasa["nasa.videos.provider.js"]
    JsonStore["json.store.js"]
    CreditSvc["credit.service.js"]
    Idempotency["idempotency.firestore.js"]
    RenderSem["render.semaphore.js"]
  end

  subgraph Storage["Storage / DB"]
    FStorage["Firebase Storage"]
    FStore["Firestore"]
  end

  Article -->|"POST /story/start, create-manual-session"| StoryRoutes
  Article -->|"POST /story/generate, plan, search, update-shot, ..."| StoryRoutes
  Article -->|"POST /story/finalize"| StoryRoutes
  Article -->|"GET /shorts/:id/status"| ShortsRoutes
  StoryRoutes --> StorySvc
  StorySvc --> StoryLLM
  StorySvc --> Pexels
  StorySvc --> Pixabay
  StorySvc --> Nasa
  StorySvc --> JsonStore
  StorySvc --> CreditSvc
  StorySvc --> Idempotency
  StorySvc --> RenderSem
  StorySvc --> FStorage
  StorySvc --> FStore
  ShortsRoutes --> FStore
```

---

## 6. Pipeline Stages (A → F)

### A) Start / create session

```mermaid
sequenceDiagram
  participant FE as creative.article.mjs
  participant API as api.mjs
  participant Route as story.routes.js
  participant Svc as story.service.js
  participant Store as json.store.js
  participant Storage as Firebase Storage

  FE->>API: apiFetch('/story/start') or /story/create-manual-session
  API->>Route: POST /api/story/start (or /manual)
  Route->>Svc: createStorySession() / createManualStorySession()
  Svc->>Store: saveStorySession()
  Store->>Storage: drafts/{uid}/{studioId}/story.json
```

- **Backend:** `story.routes.js` → POST `/start`, POST `/manual` (create-manual-session flow).
- **Service:** `story.service.js` → `createStorySession()`, `saveStorySession()`.
- **Storage:** Session is JSON in **Firebase Storage** (not Firestore): `drafts/{uid}/story-<id>/story.json`. That JSON is the central object many story routes read/write.

### B) Generate script + plan beats

```mermaid
flowchart LR
  FE["creative.article.mjs"] -->|"POST /story/generate"| R1["story.routes.js"]
  FE -->|"POST /story/plan"| R1
  R1 --> Svc["story.service.js"]
  Svc --> LLM["story.llm.service.js"]
  LLM -->|"generateStoryFromInput"| Svc
  LLM -->|"planVisualShots"| Svc
```

- **Routes:** POST `/story/generate`, POST `/story/plan`.
- **Service:** `generateStory()`, `planShotsForStory()`; LLM: `generateStoryFromInput()`, `planVisualShots()`.
- **Contract:** Any change to session shape (sentences, shots, caption style fields) affects generate, plan, update-shot, search-shot, timeline, captions, finalize.

### C) Storyboard asset search / shot editing

```mermaid
flowchart LR
  FE["creative.article.mjs"] -->|"POST /story/search"| R["story.routes.js"]
  FE -->|"POST /story/search-shot"| R
  FE -->|"POST /story/update-shot"| R
  FE -->|"POST /story/update-video-cuts"| R
  R --> Svc["story.service.js"]
  Svc --> P["pexels / pixabay / nasa providers"]
```

- **Routes:** POST `/story/search`, `/story/search-shot`, `/story/update-shot`, `/story/update-video-cuts`.
- **Service:** `searchShotsForSentence()`, etc.; providers: `pexels.videos.provider.js`, `pixabay.videos.provider.js`, `nasa.videos.provider.js`.
- **Separate surface:** `/api/assets` (assets.routes.js, assets.controller.js, assets.options.service.js) is for asset browsing/options; `/story/search*` is tied to story beats.

### D) Caption preview + caption metadata handshake

One of the most interconnected parts: **three places** must stay in sync.

```mermaid
flowchart TB
  subgraph Frontend["Frontend"]
    CP["caption-preview.js"]
  end
  subgraph Backend["Backend"]
    CaptionRoute["caption.preview.routes.js"]
    StoryRoute["story.routes.js"]
  end
  subgraph Data["Same session JSON"]
    Session["drafts/.../story.json"]
  end

  CP -->|"POST /caption/preview"| CaptionRoute
  CP -->|"POST /story/update-caption-meta"| StoryRoute
  StoryRoute --> Session
  CaptionRoute -->|"raster metadata (SSOT)"| Session
```

| Piece       | File(s)                                | Role                                                                                 |
| ----------- | -------------------------------------- | ------------------------------------------------------------------------------------ |
| Frontend    | `web/public/js/caption-preview.js`     | Uses `apiFetch('/caption/preview')`; batches writes to `/story/update-caption-meta`. |
| Preview API | `src/routes/caption.preview.routes.js` | POST `/caption/preview`; requireAuth + rate limit; SSOT raster metadata logic.       |
| Persistence | `src/routes/story.routes.js`           | POST `/story/update-caption-meta` writes into story session.                         |

Caption changes often touch all three; changing only one can cause drift.

### E) Finalize / render (main support beam)

**Frontend:** `creative.article.mjs` calls `POST /story/finalize`, then polls `GET /shorts/:id/status`.

**Backend finalize stack (story.routes.js):**

```mermaid
flowchart TB
  R["POST /finalize"]
  R --> Auth["requireAuth"]
  Auth --> Idem["idempotencyFinalize (credit reserve, dedupe, replay)"]
  Idem --> Handler["Route handler"]
  Handler --> Slot["withRenderSlot()"]
  Slot --> Finalize["finalizeStory()"]
  Finalize --> Render["renderStory()"]
```

- **Middleware:** `requireAuth` (JWT → req.user); `idempotencyFinalize` (dedupe, stale/done replay, credit reserve).
- **Handler:** Calls `withRenderSlot(() => finalizeStory(...))` (render.semaphore.js for concurrency).
- **Service:** `story.service.js` → `finalizeStory()` → `renderStory()`.

**What renderStory() touches:**

```mermaid
flowchart LR
  Render["renderStory()"]
  Render --> Session["Read session JSON (Storage)"]
  Render --> Timeline["Build timeline / trim clips (FFmpeg)"]
  Render --> TTS["TTS + timestamps"]
  Render --> ASS["Karaoke ASS captions"]
  Render --> Video["Render final video"]
  Render --> Upload["Upload video + cover → Storage artifacts/"]
  Render --> Firestore["Write shorts doc → Firestore"]
```

| Data store         | Use during finalize                            |
| ------------------ | ---------------------------------------------- |
| Draft session JSON | Firebase Storage `drafts/{uid}/.../story.json` |
| Credits            | Firestore `users/{uid}` (credit.service.js)    |
| Idempotency        | Firestore idempotency collection               |
| Final artifacts    | Firebase Storage `artifacts/{uid}/{jobId}/...` |
| Short job/status   | Firestore `shorts/{jobId}`                     |

Touching finalize can affect credits, idempotency, storage, and shorts status.

### F) Polling result / My Shorts

```mermaid
sequenceDiagram
  participant FE as creative.article.mjs
  participant API as api.mjs
  participant Shorts as shorts.routes.js
  participant Ctrl as shorts.controller.js
  participant FS as Firestore shorts

  FE->>API: apiFetch('/shorts/:shortId/status')
  API->>Shorts: GET /api/shorts/:id/status
  Shorts->>Ctrl: status handler
  Ctrl->>FS: read shorts doc
  FS-->>FE: job status
```

- **Backend:** `shorts.routes.js` → `shorts.controller.js` (reads Firestore shorts docs). This is the “tail” of the pipeline.

---

## 7. Repo-Wide Communication Map (Short)

**Main chain:**

```
Creative UI
  → api.mjs (auth/token/api envelope)
  → /api/story/* routes (route-level guards)
  → story.service.js (orchestration)
  → helpers/providers (story.llm.service, stock providers, TTS, FFmpeg, storage utils)
  → Storage / Firestore
  → /api/shorts/* status/read
  → UI polling / display
```

**Parallel caption branch:**

```
Caption editing
  → caption-preview.js
  → /api/caption/preview
  → /api/story/update-caption-meta
  → same story session JSON used by finalize
```

The caption branch is tightly tied to the main render branch via shared session shape and caption metadata.

---

## 8. Where to Scope Changes (By Surface)

Scope by **surface**, not by single file.

| Surface                      | If you touch…                                  | Always review                                                                                                                                                                                            |
| ---------------------------- | ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Story session contract**   | Session shape (beats, shots, captions, styles) | story.routes.js, story.service.js, creative.article.mjs, caption-preview.js (if captions)                                                                                                                |
| **Finalize / render safety** | Render, credits, retries                       | story.routes.js finalize stack, idempotency.firestore.js, planGuards.js, render.semaphore.js, credit.service.js, story.service.js (finalizeStory + renderStory), creative.article.mjs finalize + polling |
| **Auth / API plumbing**      | Auth, login, API errors                        | api.mjs, auth-bridge.js, firebaseClient.js, requireAuth.js, /users, /whoami, /credits routes                                                                                                             |

---

## 9. Quick Reference: Key Files

| Layer               | Key files                                                                                                                                   |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Page shell          | `web/public/creative.html`                                                                                                                  |
| Orchestrator        | `web/public/js/pages/creative/creative.article.mjs`                                                                                         |
| API/auth glue       | `web/public/api.mjs`, `web/public/auth-bridge.js`, `web/public/js/firebaseClient.js`                                                        |
| Backend entry       | `server.js`, `src/app.js`                                                                                                                   |
| Route registry      | `src/routes/index.js`                                                                                                                       |
| Story API           | `src/routes/story.routes.js`                                                                                                                |
| Caption preview API | `src/routes/caption.preview.routes.js`                                                                                                      |
| Shorts read         | `src/routes/shorts.routes.js`, `src/controllers/shorts.controller.js`                                                                       |
| Story brain         | `src/services/story.service.js`                                                                                                             |
| Story LLM           | `src/services/story.llm.service.js`                                                                                                         |
| Session storage     | `src/utils/json.store.js` (Storage path: drafts/…)                                                                                          |
| Finalize guards     | `src/middleware/requireAuth.js`, `src/middleware/idempotency.firestore.js`, `src/middleware/planGuards.js`, `src/utils/render.semaphore.js` |
| Credits             | `src/services/credit.service.js`                                                                                                            |

---

_This diagram is documentation only; no application code or files were changed, added, or deleted._
