#!/usr/bin/env bash
# Creates infra/deploy/.env from .env.example with fresh random secrets, or fills
# in any that are empty. Never overwrites a value that is already set.
set -euo pipefail
cd "$(dirname "$0")"

[[ -f .env ]] || cp .env.example .env
chmod 600 .env

hex() { openssl rand -hex "$1"; }
fill() {
  local key=$1 value=$2
  if grep -qE "^${key}=$" .env; then
    # | as the delimiter: generated values are hex, so they never contain it.
    sed -i.bak "s|^${key}=$|${key}=${value}|" .env && rm -f .env.bak
    echo "generated ${key}"
  fi
}

fill POSTGRES_PASSWORD "$(hex 24)"
fill REDIS_PASSWORD "$(hex 24)"
fill KRATOS_SECRETS_COOKIE "$(hex 32)"
fill KRATOS_SECRETS_CIPHER "$(hex 16)" # exactly 32 characters, as Kratos requires
fill KRATOS_WEBHOOK_SECRET "$(hex 32)"

echo "Now fill in the R2, Resend and backup settings in infra/deploy/.env."
