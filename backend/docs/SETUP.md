# Development setup (local, free, fake data only)

Everything here runs on your own computer. Nothing is deployed, no external account is needed, nothing costs money.

## 1. One-time installs (free, open source, no sudo)
| Tool | Purpose |
|---|---|
| Colima + Lima | Runs containers in a small Linux VM (instead of Docker Desktop) |
| docker CLI + docker-compose | Talks to Colima |

**Windows (Git Bash + Docker Desktop):** instead of Colima the scripts accept Docker Desktop, but only its own local engine: context `desktop-linux`, the local named pipe `npipe:////./pipe/dockerDesktopLinuxEngine` and engine name `docker-desktop`. `DOCKER_HOST` and `DOCKER_CONTEXT` must still be unset, and the Colima checks above are unchanged on macOS/Linux. `backend/scripts/colima-up.sh` and `backend/scripts/colima-down.sh` are not used on Windows; start Docker Desktop instead. Node 24 is required (`backend/package.json` engines); install it in your user folder and put it first on `PATH` for this project only.

On this Intel Mac they were installed from the official release files into `~/.local/newscafe-tools/` (Colima 0.10.3, Lima 2.2.1, Docker CLI 29.9.2, Docker Compose 5.6.1). The scripts add that folder to their search path themselves. Homebrew is not used (it has no ready-made packages for Intel macOS 15 and needs a root-owned folder changed). Checksums were verified for Colima, Lima and Compose; the Docker CLI download publishes none.

## 2. Start the container runtime (on demand)
```
backend/scripts/colima-up.sh        # 2 CPUs, 2 GB RAM, 20 GB disk; stop with backend/scripts/colima-down.sh
```

## 3. Database
```
backend/scripts/db-up.sh            # creates backend/database/.env (random dev password, git-ignored) and starts PostgreSQL 17
backend/scripts/db-reset.sh         # drops/recreates the DEV database, applies migrations, loads FAKE seed data
backend/scripts/db-test.sh          # full test suite on throw-away databases
backend/scripts/db-down.sh          # stops the database (data kept)
```
Container images used (all official, pinned): `postgres:17-alpine`, `alpine:3.22` (to build the tiny local `newscafe-tools` image containing `age`), `ghcr.io/gitleaks/gitleaks:v8.30.1`.

## 4. Backups and the recovery drill
```
backend/scripts/backup.sh           # encrypted backup of the dev database
backend/scripts/restore-drill.sh    # backup -> restore into a throw-away copy -> verify -> clean up
```
See [BACKUP-RECOVERY.md](BACKUP-RECOVERY.md).

## 5. Before every commit
The pre-commit hook (`git config core.hooksPath scripts/githooks`, already set by the setup) runs `scripts/check-repo.sh` and `scripts/scan-secrets.sh`. Both can also be run by hand. The commit is refused if a PDF, `.env` file, key, dump, file outside the allow-list or a possible secret is staged.

## 6. The API (milestone A2)
```
backend/scripts/db-migrate.sh       # applies migrations 0008-0010 (API roles and functions) if the database predates them
backend/scripts/db-roles.sh         # creates backend/.env.public and backend/.env.admin (random dev secrets, git-ignored) and turns on LOGIN for the two API database roles
cd backend && npm ci            # exact pinned packages; install scripts are disabled (backend/.npmrc)
backend/scripts/create-owner.sh     # ONE fake development owner (dev-owner@example.invalid); the random password is shown once and stored nowhere
backend/scripts/api-dev.sh          # starts the public API (127.0.0.1:8787) and the owner API (127.0.0.1:8788); Ctrl-C stops both
backend/scripts/api-test.sh         # type-check + all API tests against a throw-away database (the dev database is not touched)
```
**Two processes, two settings files.** `backend/.env.public` holds only the public database login; `backend/.env.admin` holds only the admin database login and the two keys. Each process refuses to start if it can see the other's secrets (see [API.md](API.md)).
Owner sign-in: e-mail address and password only; a correct password opens the dashboard at once (there is no authenticator or recovery-code step). A new owner's password must be at least 12 characters; `create-owner.sh` generates a random 24-character one.

## Safety rules
* Every script that uses Docker first checks that `DOCKER_HOST` and `DOCKER_CONTEXT` are **not** set and that the engine is the local Colima engine (context `colima`, socket in `~/.colima`). Otherwise it stops. (On GitHub's CI runner, which has no Colima, only the runner's own local Docker socket is accepted.)
* `backend/database/.env` is read as plain data: only the five known keys, each once, with simple values. It is never run as a shell script.
* The fake seed refuses to run unless the database is named `newscafe_dev`, is labelled `development` and is empty.
* `backend/database/.env` is git-ignored and generated; never share or commit it.
* The scripts only talk to the local container and refuse any database not named `newscafe_dev` or `newscafe_test*`.
* Development and staging use **fake data only**. Real customer data never leaves production.
* The frontend (`frontend/`) is not changed by this setup.
