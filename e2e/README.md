# e2e: tests that need BOTH the frontend and the backend

`frontend/` and `backend/` each test themselves (see their own READMEs). This folder holds the few checks that cross the boundary. It is the only place allowed to import from both areas. Fake data only; nothing here touches production.

| File | Needs running | What it checks |
|---|---|---|
| `parity.test.mjs` | nothing (files only) | The dashboard knows every reservation status and audit action the backend writes; the login form's password limit equals the backend's |
| `live-api.mjs` | frontend dev server (`:3000`) + public API (`:8787`) + owner API (`:8788`) + dev database | `PHASE=A`: pages, headers, proxy, CORS, CSRF, validation, default-deny, public/admin separation, second-factor routes gone. `PHASE=B`/`C`: password-only sign-in, logout, expiry, lock-out, rate limit. B and C sign in and lock the account, so they need a **disposable** `@example.invalid` owner (never a real owner) |
| `live-ui.mjs` | the same, plus Microsoft Edge | The real login and dashboard in a real browser against the real servers (read-only on bookings). Needs a **disposable** owner |
| `gen-ui-fixtures.mjs` | the dev database container | Regenerates `frontend/tests/fixtures/admin-api.json` (fake data) used by the frontend's own browser test |

```
node --test e2e/parity.test.mjs                                  # Node 24
PHASE=A node e2e/live-api.mjs
node e2e/gen-ui-fixtures.mjs
```
Start the servers with `cd backend && npm run dev` and `cd frontend && npm run dev`. Use **Node 24** (see `backend/package.json` engines).
