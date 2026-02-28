# AGENTS.md

## Cursor Cloud specific instructions

### Overview

Vaiform is a short-form video creation platform (SaaS). The repo has two components:

- **Backend** (Express/Node.js): root `/` — `npm start` runs `node server.js` on port 3000
- **Frontend** (React/Vite/TypeScript/Tailwind): `web/` — `npm run dev` runs Vite on port 5173

### Running the backend without real Firebase credentials

Set `NODE_ENV=test` to bypass `envCheck()` strict credential validation. You still need a valid RSA private key for `firebase-admin` to parse at import time. Generate one with:

```
openssl genpkey -algorithm RSA -out /tmp/test-key.pem -pkeyopt rsa_keygen_bits:2048
```

Then start with:

```
NODE_ENV=test \
  FIREBASE_PROJECT_ID=test-project \
  FIREBASE_STORAGE_BUCKET=test-bucket.appspot.com \
  FIREBASE_CLIENT_EMAIL=test@test-project.iam.gserviceaccount.com \
  FIREBASE_PRIVATE_KEY="$(cat /tmp/test-key.pem)" \
  node server.js
```

The backend will boot and serve the health endpoint at `GET /health`, but features requiring real Firebase/OpenAI/Stripe will not work.

### Running the frontend dev server

```
cd web && VITE_API_BASE=http://localhost:3000 npm run dev
```

### Lint, format, and test commands

See `package.json` scripts. Key ones:

- `npm run lint` — ESLint (scoped to specific files)
- `npm run format:check` — Prettier check
- `npm test` — placeholder (no tests yet, exits 0)
- `npm run test:security` — privilege escalation check

### Gotchas

- The `web/` lockfile may have issues with rollup native modules. If `npm run build` fails with a rollup error, delete `web/node_modules` and `web/package-lock.json`, then re-run `npm install` in `web/`.
- The pre-commit hook (`.husky/pre-commit`) runs `npm test`, which currently exits 0 (no tests).
- The frontend build (`web/npm run build`) also runs `copy-public` which copies `public/` into `web/dist/` for SPA hosting from the backend.
- The backend serves the built SPA from `web/dist/` when that directory exists. For development, use the Vite dev server on port 5173 instead.
