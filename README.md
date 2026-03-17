# Start Here (Repo Bible)

This repository's docs front door is:

- `docs/DOCS_INDEX.md` - backend docs ownership, precedence, canonical docs, and the cross-repo split.

Use `docs/DOCS_INDEX.md` first. It points to the current backend canonical docs, the mobile repo's caller-truth docs, and the non-canonical historical material that should not drive edits.

Defaults and precedence:

- Default flags: `VAIFORM_DEBUG=0`.
- Frontend source of truth: `web/public`.
- Netlify build root: `web`, publish dir: `dist`.
- Backend posture: API-only (no frontend HTML/static hosting).
- Backend still serves required fonts at `/assets/fonts/*`.
- Mobile repo owns current caller-truth; backend repo owns server contract/hardening/legacy docs.
- Evidence and historical docs remain searchable, but they are not the first docs to update for mobile/backend contract work.

Netlify redirect/proxy rules are managed in `netlify.toml`.
