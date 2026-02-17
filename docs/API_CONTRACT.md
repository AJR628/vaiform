# API Response Contract

All JSON API responses must use this envelope so clients and tests never have to guess the shape.

## Success

```json
{
  "success": true,
  "data": <any>,
  "requestId": "<string or null>"
}
```

- **success:** Always `true`.
- **data:** Response payload (any type). May be omitted when undefined; key should still be present for consistency.
- **requestId:** From middleware (`req.id`); string or `null` if missing.

## Failure

```json
{
  "success": false,
  "error": "<string>",
  "detail": "<string>",
  "fields": { "<path>": "<message>" },
  "requestId": "<string or null>"
}
```

- **success:** Always `false`.
- **error:** Error code (e.g. `VALIDATION_FAILED`, `UNAUTHENTICATED`, `FORBIDDEN`, `ERROR`).
- **detail:** Human-readable message.
- **fields:** Optional. Present for validation errors; object keyed by field path, value is message. Omit key entirely when not applicable.
- **requestId:** Same as success.

## Required keys

| Response | Required keys                             |
| -------- | ----------------------------------------- |
| Success  | `success`, `data`, `requestId`            |
| Failure  | `success`, `error`, `detail`, `requestId` |

## Disallowed keys

Do not use these in JSON API responses (they are legacy; target is this contract only):

- `ok`, `reason`
- `code`, `message`
- `details` (use `fields` for validation errors)
- `issues` (use `fields` with path-keyed object)
- Url-only success payloads (e.g. `{ "url": "..." }` without `success`, `data`, `requestId`)

Existing endpoints may still emit these until migrated; new code and framework-level middleware (e.g. validate, error handler) must use the contract.

## requestId

Set by `reqId` middleware from the `X-Request-Id` request header or a generated UUID. Must be included in every JSON response so clients can correlate logs and support requests.

## Helpers

Use `src/http/respond.js`:

- `respond.ok(req, res, data)` — success response.
- `respond.fail(req, res, status, error, detail, fields?)` — failure response.
