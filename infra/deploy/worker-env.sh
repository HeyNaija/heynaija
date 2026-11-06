#!/usr/bin/env bash
# Prints the .env for production's video worker on its own server (compose.worker.yml),
# made from this server's (production's) infra/deploy/.env: the settings the worker's
# compose file reads, copied as they are, plus what that server needs of its own.
# Nothing is written here. Send it straight to the other server, so the secrets in it
# never show on a screen (docs/deployment/production.md, section 7):
#   ssh heynaija@<production> /srv/heynaija/infra/deploy/worker-env.sh \
#     | ssh heynaija@<worker> 'umask 077 && cat > /srv/heynaija/infra/deploy/.env'
# An argument gives the worker's server's cores: 4 (an RS 1000) unless told otherwise,
# `worker-env.sh 8` on an RS 2000.
set -euo pipefail
cores=${1:-4}
[[ $cores =~ ^[1-9][0-9]?$ ]] || { echo "usage: worker-env.sh [cores]" >&2; exit 2; }
cd "$(dirname "$0")"
env_file=${WORKER_ENV_SOURCE:-.env}
[[ -r $env_file ]] || { echo "No $env_file here: run this on the production server." >&2; exit 1; }

# Set below for the worker's server, whatever production's .env says.
own=(COMPOSE_PROJECT_NAME COMPOSE_FILE COMPOSE_PROFILES DEPLOY_ROLE DATABASE_TUNNEL_ADDRESS VIDEO_WORKER_CPUS VIDEO_WORKER_MEMORY)

tunnel=$(sed -n 's/^DATABASE_TUNNEL_ADDRESS=//p' "$env_file" | tail -n 1)
[[ -n $tunnel ]] || { echo "DATABASE_TUNNEL_ADDRESS is not set in $env_file: set up the tunnel first (production.md, section 7)." >&2; exit 1; }

cat <<HEAD
# Production's video worker on its own server (docs/deployment/production.md,
# section 7). Written by worker-env.sh from production's .env on $(date -u +%F).
# To change a shared setting (a password, a key, a limit), change it on production
# and run worker-env.sh again.
COMPOSE_PROJECT_NAME=heynaija-video-worker
COMPOSE_FILE=compose.worker.yml
DEPLOY_ROLE=video-worker
DATABASE_TUNNEL_ADDRESS=$tunnel
# The server's cores and the worker's memory (ADR 0021 section 5).
VIDEO_WORKER_CPUS=$cores
VIDEO_WORKER_MEMORY=1.5g

# Copied from production.
HEAD

# What the deploy scripts read, and every variable the worker's compose file uses
# (RELEASE comes from deploy.sh). A setting production leaves unset stays unset.
{ printf '%s\n' DEPLOY_BRANCH IMAGE_PREFIX; grep -o '\${[A-Z0-9_]*' compose.worker.yml | cut -c3-; } | sort -u \
  | while read -r name; do
      [[ " ${own[*]} RELEASE " == *" $name "* ]] && continue
      grep -E "^$name=" "$env_file" | tail -n 1 || true
    done
