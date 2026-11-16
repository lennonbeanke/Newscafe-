# News Cafe backend

Public API, owner (admin) API, authentication and security, PostgreSQL migrations, backend scripts and tests. Local development only, fake data only.

```
backend/
├─ src/        the two API processes: server-public.ts (:8787) and server-admin.ts (:8788), auth/, admin/
├─ test/       API tests (vitest, run against a throw-away database)
├─ tools/      build-openapi.ts (regenerates docs/openapi*.json), create-owner.ts (via scripts/create-owner.sh)
├─ database/   migrations, fake seed data, database tests, docker-compose.yml
├─ scripts/    db-*, api-*, backup/restore, colima, gen-env (bash); all use the shared Docker guard in ../scripts/lib/docker-guard.sh
├─ docs/       SETUP, DATABASE, API, SECURITY, BACKUP-RECOVERY, openapi*.json (the contract)
└─ .env.public / .env.admin / database/.env     git-ignored, generated with random development secrets
```

**Two processes, two settings files.** `.env.public` holds only the public database login; `.env.admin` holds only the admin login and the two keys. Each process refuses to start if it can see the other's secrets (see docs/API.md).

```
npm ci --ignore-scripts      # Node 24; install scripts are disabled (.npmrc)
npm run db:up                # PostgreSQL 17 in a container
npm run db:test              # database tests (throw-away databases)
npm test                     # type-check + API tests (throw-away database)
npm run dev                  # public API :8787 + owner API :8788
npm run typecheck
npm run openapi              # regenerate docs/openapi*.json (a test fails if they are stale)
```
Every script that uses Docker first checks that the engine is a local one (Colima, or Docker Desktop on Windows). See [docs/SETUP.md](docs/SETUP.md).

**Windows:** run these commands from **Git Bash**. The npm scripts call `bash`, and in PowerShell/cmd `bash` can resolve to the WSL launcher instead. Docker Desktop is accepted by the guard (context `desktop-linux`); see docs/SETUP.md.
