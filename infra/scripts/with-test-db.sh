#!/usr/bin/env bash
# Runs a command with TEST_DATABASE_URL pointing at a scratch database on the dev
# Postgres (created on first use). In CI, set TEST_DATABASE_URL and this is a no-op.
set -euo pipefail

if [[ -z "${TEST_DATABASE_URL:-}" ]]; then
  root="$(cd "$(dirname "$0")/../.." && pwd)"
  set -a; source "$root/.env"; set +a
  docker exec heynaija-dev-postgres-1 psql -U heynaija -d heynaija -tAc \
    "select 1 from pg_database where datname = 'heynaija_test'" | grep -q 1 \
    || docker exec heynaija-dev-postgres-1 psql -U heynaija -d heynaija -qc 'create database heynaija_test'
  export TEST_DATABASE_URL="${DATABASE_URL%/*}/heynaija_test"
fi

exec "$@"
