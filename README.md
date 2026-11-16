# News Cafe

Marketing website and reservation system for News Cafe: a Next.js website with an owner dashboard (**frontend**) and a PostgreSQL-backed API (**backend**).

**Status:** local development only, fake data only. Nothing is deployed and there is no production database.

## Two working areas
| Folder | What it is | Runs on its own? |
|---|---|---|
| [`frontend/`](frontend/) | Next.js 16 public website and the owner dashboard UI (sign-in, overview), components, styling, frontend tests | Yes: `npm ci` + `npm run dev`. Needs no database and no backend code |
| [`backend/`](backend/) | Public API, owner (admin) API, authentication and security, PostgreSQL migrations, database and API tests, backend scripts | Yes: its own `package.json`, scripts and tests. Needs Docker (Colima, or Docker Desktop on Windows) and Node 24 |
| [`e2e/`](e2e/) | The few tests that need **both** areas | Needs both running (or just the source files for `parity.test.mjs`) |
| [`docs/`](docs/) | Project-level documents: ownership, go-live path, free-tier limits, plans | n/a |
| [`scripts/`](scripts/) | Repository-wide safety only: allow-list check, secret scan, boundary check, git hook, shared Docker guard | n/a |

**How they meet:** the frontend talks to the backend only over HTTP. In development the browser calls `/api/admin/*` on the site (`localhost:3000`) and Next forwards it to the owner API (`127.0.0.1:8788`). The public booking API (`127.0.0.1:8787`) is a separate process with its own database login and settings file. The contract is [`backend/docs/openapi-admin.json`](backend/docs/openapi-admin.json) / [`openapi.json`](backend/docs/openapi.json). `scripts/check-boundaries.sh` fails the commit if either area imports the other's files, if a backend secret name appears in the frontend, or if the admin and public processes import each other.

## Frontend
```
cd frontend
npm ci
npm run dev          # http://localhost:3000   (use "localhost", not 127.0.0.1)
npm run lint
npm run typecheck
npm test             # unit and static security tests (Node 24, no extra packages)
npm run test:ui      # owner dashboard in headless Edge with FAKE API answers (needs `npm run dev` running)
npm run test:ui:reservations   # reservation management in headless Edge against a stateful FAKE API
```

## Backend
```
cd backend
npm ci --ignore-scripts
npm run db:up        # local PostgreSQL in a container, fake data (first: scripts/colima-up.sh on macOS)
npm run db:test      # database tests on throw-away databases
npm test             # type-check + all API tests on a throw-away database
npm run dev          # starts the public API (:8787) and the owner API (:8788)
npm run create-owner # ONE fake development owner (dev-owner@example.invalid)
```
Setup details: [backend/docs/SETUP.md](backend/docs/SETUP.md).

## Rules
* The repository is private and owned by the business.
* No secrets, passwords, `.env` files, keys, database dumps, backups or the original menu PDFs are ever committed (enforced by `.gitignore`, a pre-commit check and a secret scan). Environment files live only in `backend/` (git-ignored); the frontend holds none.
* Development and staging use fake data only; real customer data exists only in production.
* No deployment, push or paid service without the owner's written approval.
