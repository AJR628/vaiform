# FINALIZE_CONTROL_ROOM_DASHBOARD

- Status: CANONICAL
- Owner repo: backend
- Source of truth for: Finalize Control Room / Ops Dashboard V1 page shape, access model, and data composition

## Routes

- Page shell: `/admin/finalize`
- Data endpoint: `/api/admin/finalize/data`

The page route is intentionally outside `/diag/*`.
The data route is intentionally under `/api/*`.

## Access Control

Required backend env:

- `FINALIZE_DASHBOARD_ENABLED=1`
- `FINALIZE_DASHBOARD_ALLOWED_EMAILS=user@example.com,...`

Route behavior:

- page route returns `404` when the dashboard is disabled
- data route returns `404` when the dashboard is disabled
- data route returns `401` when unauthenticated
- data route returns `403` when authenticated but not allowlisted
- data route returns `200` only for Firebase-authenticated users with verified, allowlisted email

## Data Sources

Live shared truth:

- `queueSnapshot`
- `sharedSystemPressure`
- `pressureConfig`

Threshold / proof JSON:

- `docs/artifacts/finalize-phase6/phase6-threshold-summary.json`

Local-only secondary panel:

- `localProcessObservability`

Markdown docs are linked for humans only:

- `docs/FINALIZE_SCALING_RUNBOOK.md`
- `docs/FINALIZE_THRESHOLD_REPORT.md`
- `docs/INCIDENT_TRACE_RUNBOOK.md`
- `docs/FINALIZE_ALERT_ARTIFACTS.md`

## Shared vs Local Rule

Top banner verdict uses shared truth only:

- queue depth
- oldest queued age
- retry-scheduled count
- shared backlog state
- shared render lease state
- shared provider cooldown / admission state
- Phase 6 threshold ranges from JSON

Local-only values do not drive the top banner:

- workers active
- worker saturation ratio
- readback lag
- billing mismatch count
- recent finalize events

Those remain visible only in the clearly labeled local API-process panel.

## Founder Viewing Model

Replit dev:

1. Open the backend preview URL.
2. Visit `/admin/finalize`.

Production later:

1. Open the backend origin.
2. Visit `/admin/finalize`.

This doc does not add or depend on Netlify/main-site routing.
