#!/usr/bin/env bash
# Nightly backup of both databases (the app's and Kratos's), encrypted on this
# server to an age public key and copied off it with rclone. Run from cron:
#   15 3 * * *  /srv/heynaija/infra/deploy/backup.sh >> /home/heynaija/backup.log 2>&1
# The private key that can decrypt the backups is never on this server.
#
# Media is not copied here: R2 stores it redundantly. A deleted bucket would lose
# it; see docs/deployment/staging.md, "What backups cover".
set -euo pipefail
cd "$(dirname "$0")"
set -a; source .env; set +a

: "${BACKUP_AGE_RECIPIENT:?set BACKUP_AGE_RECIPIENT in .env}"
: "${BACKUP_DESTINATION:?set BACKUP_DESTINATION in .env}"

stamp=$(date -u +%Y-%m-%dT%H%MZ)
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

for db in heynaija kratos; do
  docker compose exec -T postgres pg_dump -U heynaija --format=custom "$db" \
    | age --recipient "$BACKUP_AGE_RECIPIENT" > "$work/$db.dump.age"
  # A dump of a few hundred bytes means pg_dump failed and age encrypted nothing.
  [[ $(wc -c < "$work/$db.dump.age") -gt 1024 ]] || { echo "$stamp: $db dump looks empty"; exit 1; }
done

rclone copy --quiet "$work" "$BACKUP_DESTINATION/$stamp"
rclone delete --quiet --min-age "${BACKUP_KEEP_DAYS:-30}d" "$BACKUP_DESTINATION"
rclone rmdirs --quiet --leave-root "$BACKUP_DESTINATION"
echo "$stamp: backed up to $BACKUP_DESTINATION/$stamp"
# Tell a monitoring service it ran; if the pings stop, it alerts a person.
if [[ -n ${BACKUP_PING_URL:-} ]]; then curl -fsS -m 10 --retry 3 -o /dev/null "$BACKUP_PING_URL"; fi
