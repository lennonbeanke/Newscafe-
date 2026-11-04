#!/usr/bin/env bash
# Creates database/.env with a random DEVELOPMENT password. Never prints the password. Never overwrites.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$ROOT/database/.env"
[ ! -e "$ENV_FILE" ] || { echo "database/.env already exists; leaving it untouched."; exit 0; }
umask 077
{
  echo "APP_ENV=development"
  echo "POSTGRES_USER=newscafe_dev_user"
  echo "POSTGRES_PASSWORD=$(openssl rand -hex 24)"
  echo "POSTGRES_DB=newscafe_dev"
  echo "POSTGRES_PORT=54329"
} > "$ENV_FILE"
chmod 600 "$ENV_FILE"
echo "Created database/.env (random development password, not shown, git-ignored)."
