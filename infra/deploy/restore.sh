#!/usr/bin/env bash
# Restores both databases from a backup made by backup.sh.
#   ./restore.sh <stamp> <age-identity-file>
#   ./restore.sh latest ~/heynaija-backup.key
# It REPLACES what is in this deployment's databases, so rehearse it on a spare
# server or a laptop first (docs/deployment/staging.md, "Rehearsing a restore").
# The API and Kratos are stopped while it runs and started again afterwards.
set -euo pipefail
cd "$(dirname "$0")"
set -a; source .env; set +a

stamp=${1:?usage: restore.sh <stamp|latest> <age-identity-file>}
identity=${2:?usage: restore.sh <stamp|latest> <age-identity-file>}

if [[ $stamp == latest ]]; then
  stamp=$(rclone lsf --dirs-only "$BACKUP_DESTINATION" | sort | tail -1 | tr -d /)
fi
echo "Restoring backup $stamp from $BACKUP_DESTINATION into the databases on $(hostname)."
read -r -p "This replaces the current data. Type 'restore' to continue: " answer
[[ $answer == restore ]] || { echo "Stopped."; exit 1; }

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
rclone copy --quiet "$BACKUP_DESTINATION/$stamp" "$work"

docker compose stop web api kratos
for db in heynaija kratos; do
  age --decrypt --identity "$identity" "$work/$db.dump.age" \
    | docker compose exec -T postgres pg_restore -U heynaija --dbname "$db" --clean --if-exists --no-owner
done
docker compose up -d --wait
echo "Restored $stamp."
