#!/usr/bin/env bash
# Prints this deployment's nginx site, from nginx/heynaija.conf.template and .env.
# Usually run through install-nginx.sh; on its own it only prints.
set -euo pipefail
cd "$(dirname "$0")"
set -a; source "${ENV_FILE:-.env}"; set +a

: "${SITE_ADDRESS:?set SITE_ADDRESS in .env}"
: "${MEDIA_ORIGIN:?set MEDIA_ORIGIN in .env}"
: "${NGINX_CERT:?set NGINX_CERT in .env}"
: "${NGINX_CERT_KEY:?set NGINX_CERT_KEY in .env}"
: "${NGINX_CLIENT_CA:?set NGINX_CLIENT_CA in .env}"

export WEB_UPSTREAM=${NGINX_WEB_UPSTREAM:-127.0.0.1:${WEB_PORT:-3100}}
# The host part of the media origin, which storage expects as the Host header.
MEDIA_HOST=$(sed -E 's#^[a-z]+://##; s#/.*##' <<< "$MEDIA_ORIGIN")
export MEDIA_HOST
# The template's rewrite drops /media/ from the path, so the origin can have none.
[[ $MEDIA_ORIGIN =~ ^https?://[^/]+/?$ ]] || { echo "MEDIA_ORIGIN must be a bare origin, like https://media.heynaija.ng" >&2; exit 1; }
export MEDIA_ORIGIN=${MEDIA_ORIGIN%/}
# Looks up the media host at request time: systemd-resolved's local stub on Ubuntu.
export NGINX_RESOLVER=${NGINX_RESOLVER:-127.0.0.53}
if [[ ${ROBOTS:-noindex} == noindex ]]; then
  export ROBOTS_HEADER='    add_header X-Robots-Tag "noindex, nofollow" always;'
else
  export ROBOTS_HEADER='    # Indexed by search engines.'
fi

# Who may post LiveKit's webhook: the LiveKit server's addresses, comma-separated
# with no spaces (.env is sourced by bash). Unset, the location only denies.
LIVEKIT_WEBHOOK_ALLOW=''
from=${LIVEKIT_WEBHOOK_FROM:-}
for ip in ${from//,/ }; do
  [[ $ip =~ ^[0-9a-fA-F:.]+(/[0-9]+)?$ ]] || { echo "LIVEKIT_WEBHOOK_FROM: $ip is not an IP address" >&2; exit 1; }
  LIVEKIT_WEBHOOK_ALLOW+="        allow $ip;"$'\n'
done
export LIVEKIT_WEBHOOK_ALLOW=${LIVEKIT_WEBHOOK_ALLOW%$'\n'}

ranges=$(for list in ips-v4 ips-v6; do curl -fsS --max-time 10 "https://www.cloudflare.com/$list"; echo; done | grep -E '^[0-9a-f:.]+/[0-9]+$')
[[ $(wc -l <<< "$ranges") -gt 10 ]] || { echo "Could not fetch Cloudflare's IP ranges." >&2; exit 1; }
CLOUDFLARE_REAL_IP=$(sed 's/.*/    set_real_ip_from &;/' <<< "$ranges")
export CLOUDFLARE_REAL_IP

# Only these placeholders are replaced; nginx's own $variables are left alone.
envsubst '${SITE_ADDRESS} ${NGINX_CERT} ${NGINX_CERT_KEY} ${NGINX_CLIENT_CA} ${CLOUDFLARE_REAL_IP} ${ROBOTS_HEADER} ${MEDIA_ORIGIN} ${MEDIA_HOST} ${NGINX_RESOLVER} ${WEB_UPSTREAM} ${LIVEKIT_WEBHOOK_ALLOW}' \
  < nginx/heynaija.conf.template
