#!/usr/bin/env bash
# Creates or tops up .env at the repo root with random local-only secrets.
# Existing values are never changed, so it is safe to re-run.
set -euo pipefail

root="$(cd "$(dirname "$0")/../.." && pwd)"
env_file="$root/.env"

umask 077
touch "$env_file"

hex() { openssl rand -hex "$1"; }
# Push notifications need a VAPID key pair: P-256, both halves in base64url.
b64url() { base64 | tr -d '\n=' | tr '+/' '-_'; }
# SEC1 DER is a 7-byte header, then the 32-byte private key.
vapid_private() { printf '%s\n' "$1" | openssl ec -outform DER 2>/dev/null | tail -c +8 | head -c 32 | b64url; }
# SubjectPublicKeyInfo DER ends with the 65-byte public point.
vapid_public() { printf '%s\n' "$1" | openssl ec -pubout -outform DER 2>/dev/null | tail -c 65 | b64url; }
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

# Object storage (MinIO locally; Cloudflare R2 in production uses the same variables).
ensure S3_ENDPOINT "http://127.0.0.1:9100"
ensure S3_REGION "us-east-1"
ensure S3_ACCESS_KEY_ID "heynaija-dev"
ensure S3_SECRET_ACCESS_KEY "$(hex 20)"
ensure S3_UPLOADS_BUCKET "heynaija-uploads"
ensure S3_MEDIA_BUCKET "heynaija-media"

# Notification emails: Mailpit catches them (inbox http://127.0.0.1:8026), the same as
# Kratos's sign-in codes; Kratos's admin API is where members' addresses are kept.
# Production uses Resend through the same variable names (infra/deploy/.env.example).
ensure KRATOS_ADMIN_URL "http://127.0.0.1:4534"
ensure SMTP_CONNECTION_URI "smtp://127.0.0.1:1026"
ensure SMTP_FROM_ADDRESS "no-reply@heynaija.test"
ensure SMTP_FROM_NAME "HeyNaija"
# Look for emails that are due every few seconds instead of every minute.
ensure EMAIL_SWEEP_EVERY_S "5"

# Push notifications (docs/adr/0010). The two keys are made together, once.
if [[ -z "$(get PUSH_VAPID_PRIVATE_KEY)" && -z "$(get PUSH_VAPID_PUBLIC_KEY)" ]]; then
  pem="$(openssl ecparam -name prime256v1 -genkey -noout)"
  ensure PUSH_VAPID_PRIVATE_KEY "$(vapid_private "$pem")"
  ensure PUSH_VAPID_PUBLIC_KEY "$(vapid_public "$pem")"
fi
# Push services want an address for whoever sends, and WEB_PUBLIC_URL is not https here.
ensure PUSH_CONTACT "mailto:no-reply@heynaija.test"
# The end-to-end tests stand in for the push service on 127.0.0.1; look every two seconds.
ensure PUSH_ALLOW_LOOPBACK "true"
ensure PUSH_SWEEP_EVERY_S "2"

echo "$env_file is up to date"
