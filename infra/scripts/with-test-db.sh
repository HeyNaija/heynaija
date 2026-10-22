#!/usr/bin/env bash
# Runs a command with TEST_DATABASE_URL pointing at a scratch database on the dev
# Postgres (created on first use). In CI, set TEST_DATABASE_URL and this is a no-op.
set -euo pipefail

if [[ -z "${TEST_DATABASE_URL:-}" ]]; then
  root="$(cd "$(dirname "$0")/../.." && pwd)"
  # Read only the value this wrapper needs. Sourcing the whole development env
  # makes an unrelated malformed optional setting prevent the test database
  # setup from starting.
  database_url=$(sed -n 's/^DATABASE_URL=//p' "$root/.env" | head -n 1)
  [[ -n "$database_url" ]] || { echo "DATABASE_URL is not set in $root/.env" >&2; exit 1; }
  case "$database_url" in
    \"*\") database_url=${database_url:1:${#database_url}-2} ;;
    \'*\') database_url=${database_url:1:${#database_url}-2} ;;
  esac
  docker exec heynaija-dev-postgres-1 psql -U heynaija -d heynaija -tAc \
    "select 1 from pg_database where datname = 'heynaija_test'" | grep -q 1 \
    || docker exec heynaija-dev-postgres-1 psql -U heynaija -d heynaija -qc 'create database heynaija_test'
  export TEST_DATABASE_URL="${database_url%/*}/heynaija_test"
fi

exec "$@"
