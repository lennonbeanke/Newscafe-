# Development setup (local, free, fake data only)

Everything here runs on your own computer. Nothing is deployed, no external account is needed, nothing costs money.

## 1. One-time installs (free, open source, no sudo)
| Tool | Purpose |
|---|---|
| Colima + Lima | Runs containers in a small Linux VM (instead of Docker Desktop) |
| docker CLI + docker-compose | Talks to Colima |

On this Intel Mac they were installed from the official release files into `~/.local/newscafe-tools/` (Colima 0.10.3, Lima 2.2.1, Docker CLI 29.9.2, Docker Compose 5.6.1). The scripts add that folder to their search path themselves. Homebrew is not used (it has no ready-made packages for Intel macOS 15 and needs a root-owned folder changed). Checksums were verified for Colima, Lima and Compose; the Docker CLI download publishes none.

## 2. Start the container runtime (on demand)
```
scripts/colima-up.sh        # 2 CPUs, 2 GB RAM, 20 GB disk; stop with scripts/colima-down.sh
```

## 3. Database
```
scripts/db-up.sh            # creates database/.env (random dev password, git-ignored) and starts PostgreSQL 17
scripts/db-reset.sh         # drops/recreates the DEV database, applies migrations, loads FAKE seed data
scripts/db-test.sh          # full test suite on throw-away databases
scripts/db-down.sh          # stops the database (data kept)
```
Container images used (all official, pinned): `postgres:17-alpine`, `alpine:3.22` (to build the tiny local `newscafe-tools` image containing `age`), `ghcr.io/gitleaks/gitleaks:v8.30.1`.

## 4. Backups and the recovery drill
```
scripts/backup.sh           # encrypted backup of the dev database
scripts/restore-drill.sh    # backup -> restore into a throw-away copy -> verify -> clean up
```
See [BACKUP-RECOVERY.md](BACKUP-RECOVERY.md).

## 5. Before every commit
The pre-commit hook (`git config core.hooksPath scripts/githooks`, already set by the setup) runs `scripts/check-repo.sh` and `scripts/scan-secrets.sh`. Both can also be run by hand. The commit is refused if a PDF, `.env` file, key, dump, file outside the allow-list or a possible secret is staged.

## Safety rules
* Every script that uses Docker first checks that `DOCKER_HOST` and `DOCKER_CONTEXT` are **not** set and that the engine is the local Colima engine (context `colima`, socket in `~/.colima`). Otherwise it stops. (On GitHub's CI runner, which has no Colima, only the runner's own local Docker socket is accepted.)
* `database/.env` is read as plain data: only the five known keys, each once, with simple values. It is never run as a shell script.
* The fake seed refuses to run unless the database is named `newscafe_dev`, is labelled `development` and is empty.
* `database/.env` is git-ignored and generated; never share or commit it.
* The scripts only talk to the local container and refuse any database not named `newscafe_dev` or `newscafe_test*`.
* Development and staging use **fake data only**. Real customer data never leaves production.
* The frontend (`frontend/`) is not changed by this setup.
