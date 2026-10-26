#!/usr/bin/env bash
# Deploys a commit to this server. The GitHub workflows run it after building the
# images; you run it by hand to roll back.
#   ./deploy.sh <commit>    deploy (or go back to) that commit
#   ./deploy.sh             the latest commit on DEPLOY_BRANCH (staging or main)
#   BUILD=1 ./deploy.sh     build the images here instead of pulling them
# A failed pull is tried again up to PULL_ATTEMPTS (4) times, waiting longer each time.
# Images are tagged with the commit. The last five releases stay on the server,
# so going back to one of them needs no registry. Database migrations only ever
# add, so older code keeps working after a rollback; never write a migration that
# breaks that without planning for it.
set -euo pipefail
cd "$(dirname "$0")"
set -a; source .env; set +a
# The registry only accepts lower case; GitHub owner names may not be.
IMAGE_PREFIX=${IMAGE_PREFIX:-}
IMAGE_PREFIX=${IMAGE_PREFIX,,}

ref=${1:-origin/${DEPLOY_BRANCH:-main}}
deploy_script_hash=$(sha256sum ./deploy.sh)
git fetch --quiet origin
git -c advice.detachedHead=false checkout --quiet --detach "$ref"
RELEASE=$(git rev-parse HEAD)
export RELEASE

# Bash keeps executing the script it started, even if checkout replaced it. Use
# the requested release's instructions for manual upgrades and rollbacks too.
if [[ $(sha256sum ./deploy.sh) != "$deploy_script_hash" ]]; then
  exec bash ./deploy.sh "$RELEASE"
fi

# Kratos's image is tagged with the contents of infra/kratos, as the build job
# tags it, so a release that leaves those files alone does not restart Kratos.
KRATOS_RELEASE=$(git rev-parse HEAD:infra/kratos)
export KRATOS_RELEASE

prefix=${IMAGE_PREFIX:-heynaija}
if docker image inspect "$prefix-api:$RELEASE" "$prefix-web:$RELEASE" "$prefix-kratos:$KRATOS_RELEASE" >/dev/null 2>&1; then
  echo "Using the images already on this server for $RELEASE"
elif [[ ${BUILD:-0} == 1 ]]; then
  echo "Building $RELEASE here"
  docker compose build
else
  # A pull fails for two reasons: the build job has not pushed this release yet, or
  # the registry could not be reached (a dropped connection, a brief outage). Only
  # waiting tells them apart, so try a few times before giving up.
  attempts=${PULL_ATTEMPTS:-4}
  for ((attempt = 1; attempt <= attempts; attempt++)); do
    docker compose pull --quiet api web kratos && break
    if ((attempt == attempts)); then
      echo "Could not pull the images for $RELEASE from $prefix after $attempts tries."
      echo "Either the build job has not finished, or the registry could not be reached. (BUILD=1 builds here instead.)"
      exit 1
    fi
    echo "Pulling the images for $RELEASE failed (try $attempt of $attempts); trying again in $((attempt * ${PULL_RETRY_SECONDS:-15}))s"
    sleep $((attempt * ${PULL_RETRY_SECONDS:-15}))
  done
fi

# Compose recreates a container only when its service definition changes. Kratos
# also reads its inline config (configs.kratos, with values from .env) and files
# mounted one by one from ../kratos; a change to those alone would leave it running
# the old ones (git checkout replaces the files, and a single-file mount keeps
# showing the replaced copy). So the kratos service is labelled with a hash of all
# of them, worked out with the label itself empty.
KRATOS_INPUTS=$( { KRATOS_INPUTS='' docker compose config kratos; cat ../kratos/*.json ../kratos/*.jsonnet; } | sha256sum | cut -c1-16 )
export KRATOS_INPUTS

# Migrations run first (the api waits for them); --wait returns once every
# service is healthy, or fails.
docker compose up -d --remove-orphans --wait

# The web app end to end (web, API, database), on its loopback port. nginx is
# not in this check: it only accepts Cloudflare's client certificate.
curl -fsS -o /dev/null --max-time 20 "http://127.0.0.1:${WEB_PORT:-3100}/" \
  || { echo "The site did not answer after deploying $RELEASE"; exit 1; }

echo "$(date -u +%FT%TZ) $RELEASE" >> releases.log
echo "Deployed $RELEASE. Earlier releases: tail releases.log"

# Keep the five most recent images of each for rollback; remove older ones.
for image in "api $RELEASE" "web $RELEASE" "kratos $KRATOS_RELEASE"; do
  read -r app tag <<< "$image"
  docker image ls --format '{{.Tag}}' "$prefix-$app" | tail -n +6 \
    | grep -vx "$tag" | xargs -r -I{} docker image rm "$prefix-$app:{}" >/dev/null || true
done
docker image prune -f >/dev/null
