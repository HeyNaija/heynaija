#!/usr/bin/env bash
# One-time setup of a FRESH Ubuntu 24.04 server for HeyNaija alone (production,
# on netcup), run as root:
#   bash setup-server.sh <ssh-public-key-of-the-person-deploying>
#
# NOT for the shared staging server: it rewrites SSH and firewall settings and
# restarts Docker, which would restart everything else running there. Staging
# has its own short checklist in docs/deployment/staging.md.
#
# Read it before running it. It:
#   - installs Docker (from Docker's own apt repository), nginx, git, age and rclone
#   - creates a `heynaija` user who runs the deployment (GitHub's deploy job logs
#     in as it with a key that can only run ssh-deploy.sh: docs/deployment/staging.md, step 4)
#   - turns off SSH password logins and direct root login
#   - lets in only SSH, HTTP and HTTPS (ufw), and turns on automatic security updates
#   - has systemd keep restarting nginx if it ever fails to start
# HTTPS is only accepted from Cloudflare: nginx requires Cloudflare's client
# certificate (Authenticated Origin Pulls), see nginx/heynaija.conf.template.
set -euo pipefail

key=${1:?usage: setup-server.sh "<ssh public key>"}
[[ $(id -u) == 0 ]] || { echo "Run as root."; exit 1; }

export DEBIAN_FRONTEND=noninteractive
apt-get update -q
apt-get upgrade -yq
apt-get install -yq ca-certificates curl git ufw unattended-upgrades age rclone nginx gettext-base

# Docker Engine and the Compose plugin, from Docker's apt repository.
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
chmod a+r /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
  > /etc/apt/sources.list.d/docker.list
apt-get update -q
apt-get install -yq docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

# The deploying and admin user. Membership of the docker group is root-equivalent:
# only people trusted with the whole server get a key here.
id heynaija >/dev/null 2>&1 || useradd --create-home --shell /bin/bash --groups docker heynaija
install -d -m 700 -o heynaija -g heynaija /home/heynaija/.ssh
echo "$key" >> /home/heynaija/.ssh/authorized_keys
chown heynaija:heynaija /home/heynaija/.ssh/authorized_keys
chmod 600 /home/heynaija/.ssh/authorized_keys
install -d -o heynaija -g heynaija /srv/heynaija
# Where the Cloudflare certificates go (docs/deployment/production.md).
install -d -m 755 /etc/ssl/cloudflare
# nginx's default site would answer for any unknown host name; HeyNaija's own
# site is installed later by install-nginx.sh.
rm -f /etc/nginx/sites-enabled/default
# heynaija is the admin account too (root cannot log in over SSH). Passwordless
# sudo grants nothing the docker group does not already: both are root-equivalent.
echo 'heynaija ALL=(ALL) NOPASSWD:ALL' > /etc/sudoers.d/heynaija
chmod 440 /etc/sudoers.d/heynaija
visudo -cf /etc/sudoers.d/heynaija

# SSH: keys only, no root.
cat > /etc/ssh/sshd_config.d/10-heynaija.conf <<'SSH'
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitRootLogin no
SSH
systemctl reload ssh

ufw default deny incoming
ufw default allow outgoing
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable

# Security updates install themselves; reboots are left to a person.
dpkg-reconfigure -f noninteractive unattended-upgrades

# Those updates restart nginx, and a failed start (once, a DNS blip) used to leave
# the site down until someone noticed. Keep trying every 10 seconds instead.
install -d /etc/systemd/system/nginx.service.d
cat > /etc/systemd/system/nginx.service.d/restart.conf <<'UNIT'
[Unit]
StartLimitIntervalSec=0

[Service]
Restart=on-failure
RestartSec=10s
UNIT
systemctl daemon-reload

# Container logs are capped per service in compose.yml; this caps everything else.
cat > /etc/docker/daemon.json <<'JSON'
{ "log-driver": "json-file", "log-opts": { "max-size": "10m", "max-file": "5" } }
JSON
systemctl restart docker

echo "Done. Log in as heynaija@$(hostname -I | awk '{print $1}') from now on (root login is off)."
