#!/usr/bin/env bash
# One-time setup of a FRESH Ubuntu 24.04 server for HeyNaija's LiveKit alone
# (docs/deployment/livekit.md), run as root:
#   bash setup-server.sh <ssh-public-key-of-the-person-deploying>
#
# Read it before running it. Like infra/deploy/setup-server.sh, without nginx,
# backups or Cloudflare (media cannot go through Cloudflare). It:
#   - installs Docker (from Docker's own apt repository) and git
#   - creates a `heynaija` user who runs LiveKit, and gives it the key above
#   - turns off SSH password logins and direct root login
#   - lets in only SSH and LiveKit's ports (ufw), and turns on automatic security updates
# LiveKit and Caddy use the host's network (compose.yml), so these ufw rules are
# the real rules.
set -euo pipefail

key=${1:?usage: setup-server.sh "<ssh public key>"}
[[ $(id -u) == 0 ]] || { echo "Run as root."; exit 1; }

export DEBIAN_FRONTEND=noninteractive
apt-get update -q
apt-get upgrade -yq
apt-get install -yq ca-certificates curl git ufw unattended-upgrades

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

# LiveKit's ports (docs/adr/0017, "Ports"). 7880 (signalling) and 5349 (TURN
# behind Caddy) stay closed: only Caddy reaches them, on this machine.
ufw default deny incoming
ufw default allow outgoing
ufw allow OpenSSH
ufw allow 80/tcp comment 'certificates'
ufw allow 443/tcp comment 'signalling and TURN over TLS, through Caddy'
ufw allow 7881/tcp comment 'media over TCP'
ufw allow 7882/udp comment 'media over UDP'
ufw allow 3478/udp comment 'TURN over UDP'
ufw --force enable

# All media goes through one UDP socket (7882): LiveKit warns that the default
# receive buffer is too small for that, and suggests 5 MB.
cat > /etc/sysctl.d/90-livekit.conf <<'SYSCTL'
net.core.rmem_max = 5000000
net.core.wmem_max = 5000000
SYSCTL
sysctl --system >/dev/null

# Security updates install themselves; reboots are left to a person.
dpkg-reconfigure -f noninteractive unattended-upgrades

# Container logs are capped per service in compose.yml; this caps everything else.
cat > /etc/docker/daemon.json <<'JSON'
{ "log-driver": "json-file", "log-opts": { "max-size": "10m", "max-file": "5" } }
JSON
systemctl restart docker

echo "Done. Log in as heynaija@$(hostname -I | awk '{print $1}') from now on (root login is off)."
