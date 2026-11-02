#!/usr/bin/env bash
# Deletes Kratos's copies of the emails it sent (courier_messages) once they are
# older than KRATOS_SENT_MAIL_KEEP_DAYS (default 7). Kratos keeps every one for
# good: the address, the subject with the sign-in code, the account's email and
# handle at the time, and the browser's User-Agent. Deleting an account does not
# remove them (docs/adr/0016). A sign-in code is useless after 15 minutes; the
# copies only help to trace a delivery problem. Their delivery records
# (courier_message_dispatches) go with them.
#
# backup.sh runs this every night before it dumps the databases, so backups do
# not keep them either. By hand, on the server: bash kratos-cleanup.sh
set -euo pipefail
cd "$(dirname "$0")"
set -a; source .env; set +a

days=${KRATOS_SENT_MAIL_KEEP_DAYS:-7}
if [[ ! $days =~ ^[1-9][0-9]{0,3}$ ]]; then
  echo "KRATOS_SENT_MAIL_KEEP_DAYS must be a whole number of days from 1 to 9999, not '$days'" >&2
  exit 1
fi

deleted=$(docker compose exec -T postgres psql -U heynaija -d kratos -v ON_ERROR_STOP=1 -qtA -c \
  "with gone as (delete from courier_messages where created_at < now() - make_interval(days => $days) returning 1) select count(*) from gone")
echo "$(date -u +%Y-%m-%dT%H%MZ): deleted $deleted of Kratos's sent emails older than $days days"
