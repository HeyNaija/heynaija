#!/usr/bin/env bash
# Creates or tops up .env at the repo root with random local-only secrets.
# Existing values are never changed, so it is safe to re-run.
set -euo pipefail

root="$(cd "$(dirname "$0")/../.." && pwd)"
env_file="$root/.env"

umask 077
touch "$env_file"

hex() { openssl rand -hex "$1"; }
get() { grep -E "^$1=" "$env_file" | head -1 | cut -d= -f2- || true; }
ensure() {
  if [[ -z "$(get "$1")" ]]; then
    echo "$1=$2" >> "$env_file"
    echo "  added $1"
  fi
}

ensure POSTGRES_PASSWORD "$(hex 16)"
ensure REDIS_PASSWORD "$(hex 16)"
ensure KRATOS_SECRETS_COOKIE "$(hex 32)"
ensure KRATOS_SECRETS_CIPHER "$(hex 16)" # must be exactly 32 characters
ensure KRATOS_WEBHOOK_SECRET "$(hex 32)"

ensure DATABASE_URL "postgres://heynaija:$(get POSTGRES_PASSWORD)@localhost:5433/heynaija"
ensure REDIS_URL "redis://:$(get REDIS_PASSWORD)@localhost:6380"
ensure KRATOS_PUBLIC_URL "http://127.0.0.1:4533"

echo "$env_file is up to date"
