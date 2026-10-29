#!/usr/bin/env bash
# Fails when packages/db/src/schema.ts has drifted from the SQL in packages/db/drizzle
# (someone changed the schema without running `pnpm db:generate`), or the drizzle
# snapshots are inconsistent. Needs no database, and leaves the working tree alone:
# `generate` runs against a temporary copy of the folder.
set -euo pipefail
cd "$(dirname "$0")/.."
dir=packages/db/drizzle

pnpm --filter @heynaija/db exec drizzle-kit check

# drizzle-kit resolves --out relative to packages/db, so the copy lives there until the trap removes it.
tmp=$(mktemp -d packages/db/.db-check.XXXXXX)
trap 'rm -rf "$tmp"' EXIT
name=$(basename "$tmp")
cp -R "$dir" "$tmp/drizzle"
out="$tmp/generate.log"

# No terminal: stdin is /dev/null so drizzle-kit can never wait for an answer. When it needs one
# (a dropped and an added column: was it a rename?) it prints an error instead. It exits 0 when it
# does, so the output is checked as well as the status.
status=0
pnpm --filter @heynaija/db exec drizzle-kit generate --dialect postgresql --schema ./src/schema.ts --out "./$name/drizzle" </dev/null >"$out" 2>&1 || status=$?
if [ "$status" -ne 0 ] || grep -q '^Error:' "$out"; then
  cat "$out" >&2
  echo "db:check: drizzle-kit generate could not run without a terminal (likely a column dropped and another added, which it asks about as a possible rename). Run 'pnpm db:generate' and commit the result." >&2
  exit 1
fi

if ! diff -r "$dir" "$tmp/drizzle" >"$tmp/diff.txt"; then
  echo "db:check: drizzle-kit generate would change files; run 'pnpm db:generate' and commit the result:" >&2
  cat "$tmp/diff.txt" >&2
  exit 1
fi
echo "db:check: schema and migrations agree"
