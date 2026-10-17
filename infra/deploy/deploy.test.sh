#!/usr/bin/env bash
# Exercise real Git checkouts without a server, registry or running containers.
set -euo pipefail
repo_root=$(cd "$(dirname "$0")/../.." && pwd)
test_dir=$(mktemp -d)
trap 'rm -rf "$test_dir"' EXIT
export DEPLOY_TEST_GIT
DEPLOY_TEST_GIT=$(command -v git)
mkdir -p "$test_dir/bin" "$test_dir/seed/infra/deploy" "$test_dir/seed/infra/kratos/policy"

cat > "$test_dir/bin/git" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
printf 'git %s\n' "$*" >> "$DEPLOY_TEST_EVENTS"
# A changed script needs one restart; catch accidental infinite restarts.
if [[ "$*" == *' checkout '* ]]; then
  (( $(grep -c '^git .*checkout ' "$DEPLOY_TEST_EVENTS") <= 2 ))
fi
exec "$DEPLOY_TEST_GIT" "$@"
SH
cat > "$test_dir/bin/docker" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
printf 'docker %s\n' "$*" >> "$DEPLOY_TEST_EVENTS"
case "$*" in
  'image inspect '*) exit 1 ;;
  'compose pull --quiet api web kratos') ;;
  'compose config kratos') printf 'kratos config\n' ;;
  'compose up -d --remove-orphans --wait')
    [[ "$KRATOS_INPUTS" == "$DEPLOY_TEST_EXPECTED_HASH" ]] ;;
  'image ls '*|'image prune -f') ;;
  *) echo "Unexpected Docker call: $*" >&2; exit 1 ;;
esac
SH
cat > "$test_dir/bin/curl" <<'SH'
#!/usr/bin/env bash
printf 'curl %s\n' "$*" >> "$DEPLOY_TEST_EVENTS"
SH
chmod +x "$test_dir/bin/"*

seed="$test_dir/seed"
"$DEPLOY_TEST_GIT" init --quiet --bare "$test_dir/origin.git"
"$DEPLOY_TEST_GIT" -C "$seed" init --quiet --initial-branch=main
"$DEPLOY_TEST_GIT" -C "$seed" config user.name 'Deploy test'
"$DEPLOY_TEST_GIT" -C "$seed" config user.email 'deploy-test@example.invalid'
"$DEPLOY_TEST_GIT" -C "$seed" remote add origin "$test_dir/origin.git"
printf '{}\n' > "$seed/infra/kratos/schema.json"
printf '{}\n' > "$seed/infra/kratos/google.jsonnet"
printf 'Not a mounted configuration file\n' > "$seed/infra/kratos/policy/README.md"

# Workflows must bootstrap a new script even when the installed script cannot
# update itself. Running this legacy fixture is always a failure.
printf '#!/usr/bin/env bash\necho "Legacy script ran" >&2\nexit 1\n' > "$seed/infra/deploy/deploy.sh"
"$DEPLOY_TEST_GIT" -C "$seed" add .
"$DEPLOY_TEST_GIT" -C "$seed" commit --quiet -m legacy
legacy_ref=$("$DEPLOY_TEST_GIT" -C "$seed" rev-parse HEAD)

for version in older newer; do
  cp "$repo_root/infra/deploy/deploy.sh" "$seed/infra/deploy/deploy.sh"
  printf '\nprintf "%s\\n" >> "$DEPLOY_TEST_EVENTS"\n' "$version" >> "$seed/infra/deploy/deploy.sh"
  "$DEPLOY_TEST_GIT" -C "$seed" add .
  "$DEPLOY_TEST_GIT" -C "$seed" commit --quiet -m "$version"
done
newer_ref=$("$DEPLOY_TEST_GIT" -C "$seed" rev-parse HEAD)
older_ref=$("$DEPLOY_TEST_GIT" -C "$seed" rev-parse HEAD~1)
"$DEPLOY_TEST_GIT" -C "$seed" push --quiet origin main
"$DEPLOY_TEST_GIT" --git-dir="$test_dir/origin.git" symbolic-ref HEAD refs/heads/main

export PATH="$test_dir/bin:$PATH"
export DEPLOY_TEST_EXPECTED_HASH
DEPLOY_TEST_EXPECTED_HASH=$(printf 'kratos config\n{}\n{}\n' | sha256sum | cut -c1-16)

run_case() {
  local name=$1 start_ref=$2 target_ref=$3 expected_version=$4 workflow=${5:-}
  local case_dir="$test_dir/$name"
  mkdir -p "$case_dir"
  export DEPLOY_TEST_REPO="$case_dir/repo" DEPLOY_TEST_EVENTS="$case_dir/events"
  : > "$DEPLOY_TEST_EVENTS"
  "$DEPLOY_TEST_GIT" clone --quiet "$test_dir/origin.git" "$DEPLOY_TEST_REPO"
  "$DEPLOY_TEST_GIT" -C "$DEPLOY_TEST_REPO" -c advice.detachedHead=false checkout --quiet --detach "$start_ref"
  printf 'IMAGE_PREFIX=ghcr.io/HeyNaija/heynaija\nBUILD=0\n' > "$DEPLOY_TEST_REPO/infra/deploy/.env"

  if [[ -n "$workflow" ]]; then
    # Run the actual workflow body, substituting only its server checkout path.
    awk '
      /^      - name: Deploy / { deploy = 1 }
      deploy && /^        run: \|$/ { body = 1; next }
      body && /^          / {
        if ($0 == "          cd /srv/heynaija") print "cd \"$DEPLOY_TEST_REPO\""
        else { sub(/^          /, ""); print }
      }
    ' "$repo_root/.github/workflows/$workflow" > "$case_dir/run.sh"
    DEPLOY_REF="$target_ref" bash "$case_dir/run.sh" > "$case_dir/output" 2>&1 \
      || { cat "$case_dir/output"; return 1; }
  else
    bash "$DEPLOY_TEST_REPO/infra/deploy/deploy.sh" "$target_ref" > "$case_dir/output" 2>&1 \
      || { cat "$case_dir/output"; return 1; }
  fi

  grep -Fxq "$expected_version" "$DEPLOY_TEST_EVENTS"
  [[ $(grep -Ec '^(older|newer)$' "$DEPLOY_TEST_EVENTS") == 1 ]]
  grep -Fxq 'docker compose pull --quiet api web kratos' "$DEPLOY_TEST_EVENTS"
  grep -Fxq "docker image inspect ghcr.io/heynaija/heynaija-api:$target_ref ghcr.io/heynaija/heynaija-web:$target_ref ghcr.io/heynaija/heynaija-kratos:$target_ref" "$DEPLOY_TEST_EVENTS"
  grep -Fxq 'docker compose up -d --remove-orphans --wait' "$DEPLOY_TEST_EVENTS"
  grep -Fq "$target_ref" "$DEPLOY_TEST_REPO/infra/deploy/releases.log"
  echo "PASS: $name"
}

run_case staging-bootstrap "$legacy_ref" "$newer_ref" newer deploy-staging.yml
run_case production-bootstrap "$legacy_ref" "$newer_ref" newer deploy-production.yml
run_case manual-upgrade "$older_ref" "$newer_ref" newer
run_case manual-rollback "$newer_ref" "$older_ref" older
run_case unchanged-script "$newer_ref" "$newer_ref" newer
