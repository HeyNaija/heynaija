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
  'compose pull --quiet api web kratos')
    # Fail the first DEPLOY_TEST_PULL_FAILURES pulls, as a dropped connection would.
    (( $(grep -c '^docker compose pull ' "$DEPLOY_TEST_EVENTS") > ${DEPLOY_TEST_PULL_FAILURES:-0} )) ;;
  'compose config kratos') printf 'kratos config\n' ;;
  'compose up -d --remove-orphans --wait')
    [[ "$KRATOS_INPUTS" == "$DEPLOY_TEST_EXPECTED_HASH" && "$KRATOS_RELEASE" == "$DEPLOY_TEST_KRATOS_TREE" ]] ;;
  'image ls '*|'image prune -f') ;;
  'login '*) read -r password; printf 'docker password %s\n' "$password" >> "$DEPLOY_TEST_EVENTS" ;;
  'logout '*) ;;
  *) echo "Unexpected Docker call: $*" >&2; exit 1 ;;
esac
SH
cat > "$test_dir/bin/curl" <<'SH'
#!/usr/bin/env bash
printf 'curl %s\n' "$*" >> "$DEPLOY_TEST_EVENTS"
SH
# Stands in for the server's sshd, which runs the deploy key's forced command with
# what the client asked for in SSH_ORIGINAL_COMMAND.
cat > "$test_dir/bin/ssh" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
printf 'ssh %s\n' "$*" >> "$DEPLOY_TEST_EVENTS"
while [[ $1 == -* ]]; do shift 2; done
[[ $1 == heynaija@test-host ]] || { echo "Unexpected host: $1" >&2; exit 1; }
shift
SSH_ORIGINAL_COMMAND="$*" exec bash "$DEPLOY_TEST_WRAPPER"
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
  cp "$repo_root/infra/deploy/ssh-deploy.sh" "$seed/infra/deploy/ssh-deploy.sh"
  printf '# %s\n' "$version" >> "$seed/infra/deploy/ssh-deploy.sh"
  "$DEPLOY_TEST_GIT" -C "$seed" add .
  "$DEPLOY_TEST_GIT" -C "$seed" commit --quiet -m "$version"
done
newer_ref=$("$DEPLOY_TEST_GIT" -C "$seed" rev-parse HEAD)
older_ref=$("$DEPLOY_TEST_GIT" -C "$seed" rev-parse HEAD~1)
"$DEPLOY_TEST_GIT" -C "$seed" push --quiet origin main
"$DEPLOY_TEST_GIT" --git-dir="$test_dir/origin.git" symbolic-ref HEAD refs/heads/main

# A commit on another branch, which the deploy key must not deploy.
"$DEPLOY_TEST_GIT" -C "$seed" switch --quiet -c other
printf 'Not on main\n' > "$seed/other.txt"
"$DEPLOY_TEST_GIT" -C "$seed" add .
"$DEPLOY_TEST_GIT" -C "$seed" commit --quiet -m other
other_ref=$("$DEPLOY_TEST_GIT" -C "$seed" rev-parse HEAD)
"$DEPLOY_TEST_GIT" -C "$seed" push --quiet origin other
"$DEPLOY_TEST_GIT" -C "$seed" switch --quiet main

export PATH="$test_dir/bin:$PATH"
export PULL_RETRY_SECONDS=0
export DEPLOY_TEST_EXPECTED_HASH
DEPLOY_TEST_EXPECTED_HASH=$(printf 'kratos config\n{}\n{}\n' | sha256sum | cut -c1-16)

prepare_case() {
  local name=$1 start_ref=$2
  case_dir="$test_dir/$name"
  mkdir -p "$case_dir/home"
  export DEPLOY_TEST_REPO="$case_dir/repo" DEPLOY_TEST_EVENTS="$case_dir/events"
  : > "$DEPLOY_TEST_EVENTS"
  "$DEPLOY_TEST_GIT" clone --quiet "$test_dir/origin.git" "$DEPLOY_TEST_REPO"
  "$DEPLOY_TEST_GIT" -C "$DEPLOY_TEST_REPO" -c advice.detachedHead=false checkout --quiet --detach "$start_ref"
  printf 'IMAGE_PREFIX=ghcr.io/HeyNaija/heynaija\nDEPLOY_BRANCH=main\nBUILD=0\n' > "$DEPLOY_TEST_REPO/infra/deploy/.env"
  # The deploy key's forced command: a copy installed outside the checkout.
  export DEPLOY_TEST_WRAPPER="$case_dir/ssh-deploy.sh" DEPLOY_CHECKOUT="$DEPLOY_TEST_REPO"
  install -m 700 "$repo_root/infra/deploy/ssh-deploy.sh" "$DEPLOY_TEST_WRAPPER"
}

# how: empty runs deploy.sh by hand; `ssh` runs the deploy key's forced command as
# sshd would; a workflow file runs that workflow's deploy step, whose ssh reaches
# the forced command through the stand-in above.
run_case() {
  local name=$1 start_ref=$2 target_ref=$3 expected_version=$4 how=${5:-}
  local case_dir
  prepare_case "$name" "$start_ref"
  # Kratos's image is tagged with the contents of infra/kratos, not the commit.
  export DEPLOY_TEST_KRATOS_TREE
  DEPLOY_TEST_KRATOS_TREE=$("$DEPLOY_TEST_GIT" -C "$seed" rev-parse "$target_ref:infra/kratos")

  if [[ $how == ssh ]]; then
    printf 'deployer\nregistry-token\n' | SSH_ORIGINAL_COMMAND="deploy $target_ref" bash "$DEPLOY_TEST_WRAPPER" \
      > "$case_dir/output" 2>&1 || { cat "$case_dir/output"; return 1; }
  elif [[ -n $how ]]; then
    # The actual workflow step, with stand-in secrets. The body ends at its first
    # line indented less, where later jobs may follow.
    awk '
      /^      - name: Deploy / { deploy = 1 }
      deploy && /^        run: \|$/ { body = 1; next }
      body && $0 != "" && !/^          / { exit }
      body && /^          / { sub(/^          /, ""); print }
    ' "$repo_root/.github/workflows/$how" > "$case_dir/run.sh"
    HOME="$case_dir/home" GITHUB_SHA="$target_ref" GITHUB_ACTOR=deployer REGISTRY_TOKEN=registry-token \
      DEPLOY_SSH_KEY='test key' DEPLOY_KNOWN_HOSTS='test-host ssh-ed25519 test' DEPLOY_HOST=test-host DEPLOY_SSH_PORT='' \
      bash "$case_dir/run.sh" > "$case_dir/output" 2>&1 || { cat "$case_dir/output"; return 1; }
    grep -Eq "^ssh -i .*/home/\.ssh/deploy -p 22 .*-o StrictHostKeyChecking=yes .*heynaija@test-host deploy $target_ref\$" "$DEPLOY_TEST_EVENTS"
    [[ $(cat "$case_dir/home/.ssh/deploy") == 'test key' ]]
  else
    bash "$DEPLOY_TEST_REPO/infra/deploy/deploy.sh" "$target_ref" > "$case_dir/output" 2>&1 \
      || { cat "$case_dir/output"; return 1; }
  fi

  if [[ -n $how ]]; then
    # Logged in with the token from standard input, for this deploy only; and the
    # installed forced command is now the release's.
    grep -Fxq 'docker login ghcr.io --username deployer --password-stdin' "$DEPLOY_TEST_EVENTS"
    grep -Fxq 'docker password registry-token' "$DEPLOY_TEST_EVENTS"
    grep -Fxq 'docker logout ghcr.io' "$DEPLOY_TEST_EVENTS"
    grep -Fxq "# $expected_version" "$DEPLOY_TEST_WRAPPER"
  fi

  grep -Fxq "$expected_version" "$DEPLOY_TEST_EVENTS"
  [[ $(grep -Ec '^(older|newer)$' "$DEPLOY_TEST_EVENTS") == 1 ]]
  grep -Fxq 'docker compose pull --quiet api web kratos' "$DEPLOY_TEST_EVENTS"
  grep -Fxq "docker image inspect ghcr.io/heynaija/heynaija-api:$target_ref ghcr.io/heynaija/heynaija-web:$target_ref ghcr.io/heynaija/heynaija-kratos:$DEPLOY_TEST_KRATOS_TREE" "$DEPLOY_TEST_EVENTS"
  grep -Fxq 'docker compose up -d --remove-orphans --wait' "$DEPLOY_TEST_EVENTS"
  grep -Fq "$target_ref" "$DEPLOY_TEST_REPO/infra/deploy/releases.log"
  echo "PASS: $name"
}

# From a release whose deploy.sh cannot update itself, the requested release's runs.
run_case staging-bootstrap "$legacy_ref" "$newer_ref" newer deploy-staging.yml
run_case production-bootstrap "$legacy_ref" "$newer_ref" newer deploy-production.yml
run_case ssh-rollback "$newer_ref" "$older_ref" older ssh
run_case manual-upgrade "$older_ref" "$newer_ref" newer
run_case manual-rollback "$newer_ref" "$older_ref" older
run_case unchanged-script "$newer_ref" "$newer_ref" newer

# A dropped connection while pulling is tried again; a registry that stays down is
# reported after PULL_ATTEMPTS tries, saying why it may have failed.
DEPLOY_TEST_PULL_FAILURES=2 run_case pull-retried "$newer_ref" "$newer_ref" newer
[[ $(grep -c '^docker compose pull ' "$test_dir/pull-retried/events") == 3 ]]
grep -Fq 'try 1 of 4' "$test_dir/pull-retried/output"
echo "PASS: pull-retried-count"

if DEPLOY_TEST_PULL_FAILURES=99 run_case pull-gives-up "$newer_ref" "$newer_ref" newer > "$test_dir/gives-up.out" 2>&1; then
  echo 'FAIL: deploy succeeded though every pull failed' >&2; exit 1
fi
[[ $(grep -c '^docker compose pull ' "$test_dir/pull-gives-up/events") == 4 ]]
grep -Fq 'after 4 tries' "$test_dir/gives-up.out"
! grep -Fxq 'docker compose up -d --remove-orphans --wait' "$test_dir/pull-gives-up/events"
echo "PASS: pull-gives-up"

# The deploy key runs nothing but a deploy of a full commit hash on DEPLOY_BRANCH:
# anything else is refused before Git or Docker are touched.
refused() {
  local name=$1 command=$2
  local case_dir
  prepare_case "$name" "$older_ref"
  if printf 'deployer\nregistry-token\n' | SSH_ORIGINAL_COMMAND="$command" bash "$DEPLOY_TEST_WRAPPER" \
    > "$case_dir/output" 2>&1; then
    echo "FAIL: $name: the deploy key ran \"$command\"" >&2; exit 1
  fi
  ! grep -Eq '^(git .*checkout |docker )' "$DEPLOY_TEST_EVENTS"
  [[ $("$DEPLOY_TEST_GIT" -C "$DEPLOY_TEST_REPO" rev-parse HEAD) == "$older_ref" ]]
  echo "PASS: $name"
}

refused ssh-refuses-a-shell 'bash -i'
refused ssh-refuses-no-command ''
refused ssh-refuses-a-short-hash "deploy ${newer_ref:0:12}"
refused ssh-refuses-extra-words "deploy $newer_ref; rm -rf /srv/heynaija"
refused ssh-refuses-another-branch "deploy $other_ref"
grep -Fq "is not on main" "$test_dir/ssh-refuses-another-branch/output"
echo "PASS: ssh-refuses-another-branch-says-why"
