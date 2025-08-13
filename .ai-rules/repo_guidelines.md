# Vaiform Repository Guidelines

- Node v20+, ESM syntax.
- Layout:
  - server.js (Express bootstrap; should use `src/routes/index.js`)
  - src/routes/\*.routes.js (routers only)
  - src/controllers/\*.controller.js (no HTTP)
  - src/services/\*.service.js (business logic)
  - src/adapters/\* (external APIs)
  - src/config/\* (env, firebase, stripe, pricing)
  - src/utils/\* (helpers)
- Adding a route:
  1. Create/extend a controller (pure functions).
  2. Add a `*.routes.js` that maps HTTP → controller.
  3. **Do not manually edit `src/routes/index.js`** — the autowire script regenerates it.
- Keep diffs minimal and backward compatible unless a task says otherwise.
- Validate inputs in routes (zod if available, otherwise minimal checks).
