#!/usr/bin/env bash
# Creates backend/.env.public and backend/.env.admin with random DEVELOPMENT secrets. Never prints a secret. Never overwrites.
# Each process gets ONLY its own database credential: the public process cannot even see the admin password.
# Both files are git-ignored. Nothing in them is a real credential (the database holds fake data only).
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PUB="$ROOT/.env.public"; ADM="$ROOT/.env.admin"; LEGACY="$ROOT/.env"
umask 077
if [ -e "$LEGACY" ]; then rm -f "$LEGACY"; echo "Removed the superseded backend/.env (it held both passwords in one file)."; fi
if [ ! -e "$PUB" ]; then
  {
    echo "APP_ENV=development"
    echo "API_PORT=8787"
    echo "API_DB_HOST=127.0.0.1"
    echo "API_DB_PORT=54329"
    echo "API_DB_NAME=newscafe_dev"
    echo "API_DB_PUBLIC_USER=newscafe_public"
    echo "API_DB_PUBLIC_PASSWORD=$(openssl rand -hex 24)"
    echo "API_ALLOWED_ORIGIN=http://localhost:3000"
    echo "API_OUTBOX_DIR=backend/.outbox"
  } > "$PUB"; chmod 600 "$PUB"; echo "Created backend/.env.public (random development secret, not shown, git-ignored)."
fi
if [ ! -e "$ADM" ]; then
  {
    echo "APP_ENV=development"
    echo "API_ADMIN_PORT=8788"
    echo "API_DB_HOST=127.0.0.1"
    echo "API_DB_PORT=54329"
    echo "API_DB_NAME=newscafe_dev"
    echo "API_DB_ADMIN_USER=newscafe_admin"
    echo "API_DB_ADMIN_PASSWORD=$(openssl rand -hex 24)"
    echo "API_HMAC_KEY=$(openssl rand -hex 32)"
    echo "API_ADMIN_ALLOWED_ORIGIN=http://localhost:3000"
  } > "$ADM"; chmod 600 "$ADM"; echo "Created backend/.env.admin (random development secrets, not shown, git-ignored)."
fi
exit 0
