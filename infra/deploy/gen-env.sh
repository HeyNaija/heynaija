#!/usr/bin/env bash
# Creates infra/deploy/.env from .env.example with fresh random secrets, or fills
# in any that are empty. Never overwrites a value that is already set.
set -euo pipefail
cd "$(dirname "$0")"

[[ -f .env ]] || cp .env.example .env
chmod 600 .env

hex() { openssl rand -hex "$1"; }
# Push notifications need a VAPID key pair: P-256, both halves in base64url.
b64url() { base64 | tr -d '\n=' | tr '+/' '-_'; }
# SEC1 DER starts 30 len 02 01 01 04 n, then the n-byte private key. n is 32, except that
# LibreSSL (macOS's openssl) drops leading zero bytes, 1 key in 256: pad those back.
vapid_private() {
  local n
  n=$(printf '%s\n' "$1" | openssl ec -outform DER 2>/dev/null | od -An -tu1 -j6 -N1 | tr -d ' \n')
  { printf '%*s' $((32 - n)) '' | tr ' ' '\000'; printf '%s\n' "$1" | openssl ec -outform DER 2>/dev/null | tail -c +8 | head -c "$n"; } | b64url
}
# SubjectPublicKeyInfo DER ends with the 65-byte public point.
vapid_public() { printf '%s\n' "$1" | openssl ec -pubout -outform DER 2>/dev/null | tail -c 65 | b64url; }
fill() {
  local key=$1 value=$2
  if grep -qE "^${key}=$" .env; then
    # | as the delimiter: generated values are hex or base64url, so they never contain it.
    sed -i.bak "s|^${key}=$|${key}=${value}|" .env && rm -f .env.bak
    echo "generated ${key}"
  fi
}

fill POSTGRES_PASSWORD "$(hex 24)"
fill REDIS_PASSWORD "$(hex 24)"
fill KRATOS_SECRETS_COOKIE "$(hex 32)"
fill KRATOS_SECRETS_CIPHER "$(hex 16)" # exactly 32 characters, as Kratos requires
fill KRATOS_WEBHOOK_SECRET "$(hex 32)"
# Made together, and only when both are empty: half a new pair would match nothing.
if grep -qE '^PUSH_VAPID_PRIVATE_KEY=$' .env && grep -qE '^PUSH_VAPID_PUBLIC_KEY=$' .env; then
  pem="$(openssl ecparam -name prime256v1 -genkey -noout)"
  fill PUSH_VAPID_PRIVATE_KEY "$(vapid_private "$pem")"
  fill PUSH_VAPID_PUBLIC_KEY "$(vapid_public "$pem")"
fi

echo "Now fill in the R2, Resend and backup settings in infra/deploy/.env."
