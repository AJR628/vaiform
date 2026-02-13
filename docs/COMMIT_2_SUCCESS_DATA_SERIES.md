# Commit 2 — Success/Data Series

**Goal of the whole series:** Make the repo predictable by enforcing one API envelope everywhere.

**Envelope:**
- **Success:** `{ success: true, data, requestId }`
- **Failure:** `{ success: false, error, detail, fields?, requestId }`
- **Disallow:** `ok`/`reason`, `code`/`message`, `details`/`issues`, url-only success payloads.

**Rule for this series:** Only change files/routes in-scope for that commit. After each commit, run hard checks and one real Article run.

---

## Commit 2.1 — Add SSOT response helpers + contract doc (no behavior change)

**Scope (files):**
- `src/http/respond.js` (new): `ok(req, res, data)` and `fail(req, res, status, error, detail, fields?)`
- `docs/API_CONTRACT.md` (new)

**Verification:**
- App starts; no endpoint responses changed.
- No imports of `respond` anywhere yet.

**Reference:** Cursor plan for 2.1 is in `.cursor/plans/` (Commit 2.1 Respond SSOT and API Contract). Implement that plan as-is.

---

## Commit 2.2 — Standardize error + validation output

**Scope (files):**
- `src/middleware/error.middleware.js`
- `src/middleware/validate.middleware.js`

**Changes:**
- Validation/Zod errors use envelope: `error: "VALIDATION_FAILED"`, `detail: "Invalid request"`, `fields` (object keyed by path; stable shape). Remove `code`/`message`/`details` from validation middleware.
- Error middleware uses `respond.fail`; Zod-like errors map to same `fields` shape; use `fields` (not `issues`).

**Verification:**
- Trigger a known bad request to a validated endpoint → failure envelope matches contract and includes `requestId`.
- No business logic or status code changes; only response shape.

**Hard checks (after 2.2 implemented):**
- In validate.middleware.js and error.middleware.js only: response payload must not include `ok`, `reason`, `code`, `message`, `details`, `issues`, `stack`.
- **Validation failure example:** `curl -s -X POST http://localhost:3000/api/assets/options -H "Content-Type: application/json" -d '{}'` (no auth + empty body). Expect 401 or 400 with envelope: `{ "success": false, "error": "VALIDATION_FAILED" or "UNAUTHENTICATED", "detail": "...", "fields": { ... } if validation, "requestId": "..." }`. No `code`, `message`, `details`, `issues`.
- **Unauthenticated example:** `curl -s -X POST http://localhost:3000/api/story/start -H "Content-Type: application/json" -d '{"input":"x"}'` (no Authorization). Expect 401: `{ "success": false, "error": "UNAUTHENTICATED", "detail": "...", "requestId": "..." }`. No disallowed keys.

---

## After the series

Later commits can migrate Active route controllers and guards to `respond.ok`/`respond.fail` incrementally; 2.1 and 2.2 establish the SSOT and fix the highest-leverage middlewares first.
