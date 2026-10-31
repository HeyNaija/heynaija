#!/usr/bin/env bash
# Creates infra/livekit/.env from .env.example with fresh keys, or fills in any
# that are empty. Never overwrites a value that is already set. When it makes
# keys it prints, once and last, the lines the API needs in infra/deploy/.env on
# the staging server: paste them there and clear the terminal.
set -euo pipefail
cd "$(dirname "$0")"

[[ -f .env ]] || cp .env.example .env
chmod 600 .env

hex() { openssl rand -hex "$1"; }
made=0
fill() {
  local key=$1 value=$2
  if grep -qE "^${key}=$" .env; then
    # | as the delimiter: generated values are hex, so they never contain it.
    sed -i.bak "s|^${key}=$|${key}=${value}|" .env && rm -f .env.bak
    echo "generated ${key}"
    made=1
  fi
}

# LiveKit wants secrets of at least 32 characters; these are 64.
fill LIVEKIT_API_KEY "API$(hex 6)"
fill LIVEKIT_API_SECRET "$(hex 32)"
fill LIVEKIT_WEBHOOK_KEY "HOOK$(hex 6)"
fill LIVEKIT_WEBHOOK_SECRET "$(hex 32)"

echo ".env is up to date"

# The block below is printed last and is valid in a bash-sourced .env as it
# stands (prose only in comments, plain values), so pasting all of it is safe.
if [[ $made == 1 ]]; then
  set -a; source .env; set +a
  ip=$(curl -4 -fsS --max-time 10 https://api.ipify.org || true)
  if [[ $ip =~ ^[0-9]+(\.[0-9]+){3}$ ]]; then
    from="LIVEKIT_WEBHOOK_FROM=${ip}"
  else
    from="# LIVEKIT_WEBHOOK_FROM= (the address lookup failed: put this server IPv4 here)"
  fi
  cat <<EOF

# LiveKit for Gists (docs/deployment/livekit.md, step 5). Paste these lines at the
# end of infra/deploy/.env on the staging server, then add CALLS_ENABLED=true,
# CALLS_GISTS_ENABLED=true and CALLS_MEMBERS (handles, comma-separated, no spaces).
LIVEKIT_URL=wss://${LIVEKIT_DOMAIN}
LIVEKIT_API_KEY=${LIVEKIT_API_KEY}
LIVEKIT_API_SECRET=${LIVEKIT_API_SECRET}
LIVEKIT_WEBHOOK_KEY=${LIVEKIT_WEBHOOK_KEY}
LIVEKIT_WEBHOOK_SECRET=${LIVEKIT_WEBHOOK_SECRET}
${from}
EOF
fi
