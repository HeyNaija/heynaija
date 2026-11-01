#!/usr/bin/env bash
# kratos-cleanup.sh, and backup.sh running it, with Docker, age and rclone stood in for.
set -euo pipefail
repo_root=$(cd "$(dirname "$0")/../.." && pwd)
test_dir=$(mktemp -d)
trap 'rm -rf "$test_dir"' EXIT
export EVENTS="$test_dir/events"

mkdir -p "$test_dir/bin" "$test_dir/deploy"
cp "$repo_root/infra/deploy/kratos-cleanup.sh" "$repo_root/infra/deploy/backup.sh" "$test_dir/deploy/"

# psql answers how many rows the delete removed, or fails when CLEANUP_FAILS is set;
# pg_dump writes something bigger than an empty dump.
cat > "$test_dir/bin/docker" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
printf 'docker %s\n' "$*" >> "$EVENTS"
case "$*" in
  *' psql '*) [[ -z ${CLEANUP_FAILS:-} ]] || exit 1; printf '3\n' ;;
  *' pg_dump '*) head -c 2048 /dev/zero ;;
  *) echo "Unexpected Docker call: $*" >&2; exit 1 ;;
esac
SH
printf '#!/usr/bin/env bash\ncat\n' > "$test_dir/bin/age"
printf '#!/usr/bin/env bash\nprintf "rclone %%s\\n" "$*" >> "$EVENTS"\n' > "$test_dir/bin/rclone"
chmod +x "$test_dir/bin/"*
export PATH="$test_dir/bin:$PATH"

fail() { echo "FAIL: $*" >&2; exit 1; }
cleanup_with() {
  printf '%s\n' "$@" > "$test_dir/deploy/.env"
  : > "$EVENTS"
  bash "$test_dir/deploy/kratos-cleanup.sh"
}

# Seven days unless set, also when set empty.
for env in '' 'KRATOS_SENT_MAIL_KEEP_DAYS='; do
  out=$(cleanup_with "$env")
  grep -q "delete from courier_messages where created_at < now() - make_interval(days => 7)" "$EVENTS" || fail "default period not used for '$env'"
  [[ $out == *'deleted 3 of Kratos'"'"'s sent emails older than 7 days' ]] || fail "unexpected report: $out"
done

out=$(cleanup_with 'KRATOS_SENT_MAIL_KEEP_DAYS=30')
grep -q 'make_interval(days => 30)' "$EVENTS" || fail 'a set period is not used'
grep -q -- '-d kratos -v ON_ERROR_STOP=1' "$EVENTS" || fail 'not run against the kratos database, stopping on errors'

# Anything that is not a plain number of days never reaches the database.
for bad in 0 -1 1.5 abc 10000 "7) or (true" '7; drop table identities'; do
  if cleanup_with "KRATOS_SENT_MAIL_KEEP_DAYS='$bad'" 2> "$test_dir/err" > /dev/null; then fail "accepted '$bad'"; fi
  grep -q 'must be a whole number of days' "$test_dir/err" || fail "no reason given for '$bad'"
  [[ ! -s $EVENTS ]] || fail "reached Docker with '$bad'"
done

# A failing delete fails the script.
if CLEANUP_FAILS=1 cleanup_with '' > /dev/null 2>&1; then fail 'a failed delete was reported as done'; fi

# backup.sh clears the old emails before dumping, and still backs up when that fails.
backup_env=('BACKUP_AGE_RECIPIENT=age1test' 'BACKUP_DESTINATION=remote:bucket/test')
printf '%s\n' "${backup_env[@]}" > "$test_dir/deploy/.env"
: > "$EVENTS"
out=$(bash "$test_dir/deploy/backup.sh")
first_psql=$(grep -n ' psql ' "$EVENTS" | head -1 | cut -d: -f1)
first_dump=$(grep -n ' pg_dump ' "$EVENTS" | head -1 | cut -d: -f1)
(( first_psql < first_dump )) || fail 'the clean-up did not run before the dumps'
[[ $out == *'backed up to remote:bucket/test/'* ]] || fail "backup did not finish: $out"

: > "$EVENTS"
out=$(CLEANUP_FAILS=1 bash "$test_dir/deploy/backup.sh" 2>/dev/null)
[[ $out == *"clearing Kratos's old sent emails failed; backing up anyway"* ]] || fail "the failure was not reported: $out"
[[ $out == *'backed up to remote:bucket/test/'* ]] || fail 'a failed clean-up stopped the backup'
[[ $(grep -c ' pg_dump ' "$EVENTS") == 2 ]] || fail 'both databases were not dumped'

echo 'kratos-cleanup ok'
