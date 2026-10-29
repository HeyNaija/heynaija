#!/usr/bin/env bash
# Fails when packages/db/src/schema.ts has drifted from the SQL in packages/db/drizzle
# (someone changed the schema without running `pnpm db:generate`), or the drizzle
# snapshots are inconsistent. Needs no database.
set -euo pipefail
cd "$(dirname "$0")/.."
dir=packages/db/drizzle
fingerprint() { find "$dir" -type f -exec shasum {} + | sort; }

pnpm --filter @heynaija/db exec drizzle-kit check
before=$(fingerprint)
pnpm --filter @heynaija/db exec drizzle-kit generate
after=$(fingerprint)

if [ "$before" != "$after" ]; then
  echo "db:check: drizzle-kit generate changed files; run 'pnpm db:generate' and commit the result:" >&2
  diff <(echo "$before") <(echo "$after") >&2 || true
  git status --porcelain -- "$dir" >&2 || true
  exit 1
fi
echo "db:check: schema and migrations agree"
