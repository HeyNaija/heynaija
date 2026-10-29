#!/usr/bin/env bash
# The only thing the deploy job's SSH key may do on this server: its line in
# ~heynaija/.ssh/authorized_keys forces this script, whatever the key asks for.
# The deploy workflows connect with `ssh heynaija@<server> deploy <commit>` and send
# a registry user and token on standard input, one per line. This refuses anything
# else, and any commit that is not on DEPLOY_BRANCH; logs in to the registry for
# this deploy alone; checks the commit out and runs that release's deploy.sh.
#
# It runs from an installed copy at ~heynaija/ssh-deploy.sh, outside the checkout,
# so checking out a release never changes it mid-run. After each deploy the copy is
# replaced with the release's (docs/deployment/staging.md, step 4).
set -euo pipefail

main() {
  local self verb commit extra
  self=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/$(basename "${BASH_SOURCE[0]}")
  read -r verb commit extra <<< "${SSH_ORIGINAL_COMMAND:-}"
  if [[ $verb != deploy || ! $commit =~ ^[0-9a-f]{40}$ || -n $extra ]]; then
    echo "This key can only run: deploy <full commit hash>" >&2
    exit 2
  fi

  # DEPLOY_CHECKOUT is for the tests; over SSH it cannot be set (sshd accepts no
  # such variable from the client).
  cd "${DEPLOY_CHECKOUT:-/srv/heynaija}"
  local branch prefix
  { read -r branch; read -r prefix; } < <(
    set -a; source infra/deploy/.env; printf '%s\n%s\n' "${DEPLOY_BRANCH:-main}" "${IMAGE_PREFIX:-}"
  )

  git fetch --quiet origin
  if ! git merge-base --is-ancestor "$commit" "origin/$branch" 2>/dev/null; then
    echo "$commit is not on $branch, so it is not deployed here." >&2
    exit 2
  fi

  # The workflow's token, which expires when its job ends. Without one, the pull
  # uses whatever registry login the server already has.
  local user='' token=''
  read -r user || true
  read -r token || true
  if [[ -n $token && -n $prefix ]]; then
    local registry=${prefix%%/*}
    trap 'docker logout "'"$registry"'" >/dev/null 2>&1 || true' EXIT
    docker login "$registry" --username "$user" --password-stdin <<< "$token" >/dev/null
  fi

  git -c advice.detachedHead=false checkout --quiet --detach "$commit"
  bash infra/deploy/deploy.sh "$commit"

  # The next deploy runs this release's version of this script.
  if [[ -f infra/deploy/ssh-deploy.sh ]]; then
    install -m 700 infra/deploy/ssh-deploy.sh "$self"
  fi
}

# Bash has read this whole line, and main with it, before running it: replacing the
# file above cannot change what this run does.
main "$@"; exit
