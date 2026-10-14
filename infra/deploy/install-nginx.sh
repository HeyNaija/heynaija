#!/usr/bin/env bash
# Renders and installs this deployment's nginx site, then reloads nginx. Needs sudo.
# Safe on a server nginx shares with other sites (Koinovera on staging): if the
# new configuration does not pass `nginx -t`, the previous one is put back and
# nginx is not reloaded, so the other sites are never affected.
set -euo pipefail
cd "$(dirname "$0")"
set -a; source .env; set +a

name="heynaija-${COMPOSE_PROJECT_NAME#heynaija-}"
available=/etc/nginx/sites-available/$name.conf
enabled=/etc/nginx/sites-enabled/$name.conf

rendered=$(mktemp)
trap 'rm -f "$rendered"' EXIT
./render-nginx.sh > "$rendered"

backup=""
if [[ -f $available ]]; then
  backup=$(mktemp)
  sudo cp "$available" "$backup"
fi
sudo install -m 644 "$rendered" "$available"
sudo ln -sf "$available" "$enabled"

if sudo nginx -t; then
  sudo systemctl reload nginx
  echo "Installed $available and reloaded nginx."
else
  echo "nginx rejected the new configuration; putting the previous one back." >&2
  if [[ -n $backup ]]; then sudo install -m 644 "$backup" "$available"; else sudo rm -f "$enabled" "$available"; fi
  exit 1
fi
