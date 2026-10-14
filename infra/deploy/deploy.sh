#!/usr/bin/env bash
# Deploys a commit to this server. The GitHub workflows run it after building the
# images; you run it by hand to roll back.
#   ./deploy.sh <commit>    deploy (or go back to) that commit
#   ./deploy.sh             the latest commit on DEPLOY_BRANCH (staging or main)
#   BUILD=1 ./deploy.sh     build the images here instead of pulling them
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
git fetch --quiet origin
git -c advice.detachedHead=false checkout --quiet --detach "$ref"
RELEASE=$(git rev-parse HEAD)
export RELEASE

prefix=${IMAGE_PREFIX:-heynaija}
if docker image inspect "$prefix-api:$RELEASE" "$prefix-web:$RELEASE" >/dev/null 2>&1; then
  echo "Using the images already on this server for $RELEASE"
elif [[ ${BUILD:-0} == 1 ]]; then
  echo "Building $RELEASE here"
  docker compose build
else
  docker compose pull --quiet api web \
    || { echo "No images for $RELEASE in $prefix. Did the build job finish? (BUILD=1 builds here instead.)"; exit 1; }
fi

# Migrations run first (the api waits for them); --wait returns once every
# service is healthy, or fails.
docker compose up -d --remove-orphans --wait

# The web app end to end (web, API, database), on its loopback port. nginx is
# not in this check: it only accepts Cloudflare's client certificate.
curl -fsS -o /dev/null --max-time 20 "http://127.0.0.1:${WEB_PORT:-3100}/" \
  || { echo "The site did not answer after deploying $RELEASE"; exit 1; }

echo "$(date -u +%FT%TZ) $RELEASE" >> releases.log
echo "Deployed $RELEASE. Earlier releases: tail releases.log"

# Keep the five most recent releases' images for rollback; remove older ones.
for app in api web; do
  docker image ls --format '{{.Tag}}' "$prefix-$app" | tail -n +6 \
    | grep -vx "$RELEASE" | xargs -r -I{} docker image rm "$prefix-$app:{}" >/dev/null || true
done
docker image prune -f >/dev/null
