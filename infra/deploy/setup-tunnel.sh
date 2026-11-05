#!/usr/bin/env bash
# The private link (WireGuard) between production and its video worker's own server,
# over which the worker reaches production's Postgres and Redis (ADR 0021 section 5).
# Run as root on each server, in this order (docs/deployment/production.md, section 7):
#
#   bash setup-tunnel.sh key                                       on both servers
#   bash setup-tunnel.sh production <worker's IP> <worker's key>   on production
#   bash setup-tunnel.sh worker <production's IP> <production's key>   on the worker's
#
# `key` makes this server's key pair once and prints the public half, which the
# other server's step needs. Production is 10.80.0.1 on the link and the worker
# 10.80.0.2. Production listens on UDP 51820, to the worker's address only; the
# worker connects out and keeps the link open, so it opens no port of its own.
#
# On production the step also:
#   - lets Docker publish Postgres and Redis on 10.80.0.1 (compose.tunnel.yml) while
#     the link is down (net.ipv4.ip_nonlocal_bind), so a broken link can never stop
#     Postgres starting, only the worker reaching it;
#   - drops any packet for 10.80.0.1 that did not come through the link or from this
#     server itself (heynaija-tunnel-guard.service). Linux accepts packets for its own
#     addresses on every interface, and Docker's published ports bypass ufw, so
#     without it a neighbour on the public network could reach them.
# Running a step again rewrites what it wrote; the key is kept.
set -euo pipefail

# TUNNEL_TEST_ROOT is for setup-tunnel.test.sh, which runs this against a scratch
# directory with stand-ins for the system's commands.
root=${TUNNEL_TEST_ROOT:-}
interface=heynaija
port=51820
production_address=10.80.0.1
worker_address=10.80.0.2
dir=$root/etc/wireguard
key_file=$dir/$interface.key

usage() {
  cat >&2 <<'USAGE'
bash setup-tunnel.sh key                                       on both servers
bash setup-tunnel.sh production <worker's IP> <worker's key>   on production
bash setup-tunnel.sh worker <production's IP> <production's key>   on the worker's
USAGE
  exit 2
}

valid_ip() { [[ $1 =~ ^([0-9]{1,3}\.){3}[0-9]{1,3}$ ]]; }
valid_key() { [[ $1 =~ ^[A-Za-z0-9+/]{42}[AEIMQUYcgkosw048]=$ ]]; }

make_key() {
  if ! command -v wg >/dev/null; then
    apt-get update -q
    DEBIAN_FRONTEND=noninteractive apt-get install -yq wireguard-tools
  fi
  install -d -m 700 "$dir"
  if [[ ! -s $key_file ]]; then
    (umask 077 && wg genkey > "$key_file")
  fi
}

write_config() {
  local body=$1
  (umask 077 && printf '%s\n' "$body" > "$dir/$interface.conf")
  systemctl enable "wg-quick@$interface" >/dev/null
  systemctl restart "wg-quick@$interface"
}

production() {
  local peer_ip=$1 peer_key=$2
  write_config "# Written by infra/deploy/setup-tunnel.sh: the link to the video worker's server.
[Interface]
Address = $production_address/24
ListenPort = $port
PrivateKey = $(cat "$key_file")

[Peer]
# The video worker's server, $peer_ip
PublicKey = $peer_key
AllowedIPs = $worker_address/32"

  ufw allow from "$peer_ip" to any port "$port" proto udp comment 'HeyNaija tunnel' >/dev/null

  printf 'net.ipv4.ip_nonlocal_bind = 1\n' > "$root/etc/sysctl.d/60-heynaija-tunnel.conf"
  sysctl -q -p "$root/etc/sysctl.d/60-heynaija-tunnel.conf"

  # A chain of its own, so running this again replaces the rules instead of adding to them.
  cat > "$root/usr/local/sbin/heynaija-tunnel-guard" <<GUARD
#!/bin/sh
# Written by infra/deploy/setup-tunnel.sh. Drops packets for $production_address that
# came neither through the tunnel ($interface) nor from this server (lo).
set -e
iptables -t raw -N heynaija-tunnel 2>/dev/null || iptables -t raw -F heynaija-tunnel
iptables -t raw -A heynaija-tunnel -i $interface -j RETURN
iptables -t raw -A heynaija-tunnel -i lo -j RETURN
iptables -t raw -A heynaija-tunnel -j DROP
iptables -t raw -C PREROUTING -d $production_address/32 -j heynaija-tunnel 2>/dev/null \\
  || iptables -t raw -I PREROUTING -d $production_address/32 -j heynaija-tunnel
GUARD
  chmod 755 "$root/usr/local/sbin/heynaija-tunnel-guard"
  cat > "$root/etc/systemd/system/heynaija-tunnel-guard.service" <<'UNIT'
# Written by infra/deploy/setup-tunnel.sh.
[Unit]
Description=Drop packets for HeyNaija's tunnel address that did not come through the tunnel
# Before Docker publishes Postgres and Redis on that address.
Before=docker.service

[Service]
Type=oneshot
RemainAfterExit=yes
ExecStart=/usr/local/sbin/heynaija-tunnel-guard

[Install]
WantedBy=multi-user.target
UNIT
  systemctl daemon-reload
  systemctl enable heynaija-tunnel-guard >/dev/null
  systemctl restart heynaija-tunnel-guard

  echo "The link is up on this side. Next: the worker's step on its server, then"
  echo "add the two tunnel lines to infra/deploy/.env and deploy (production.md, section 7)."
}

worker() {
  local peer_ip=$1 peer_key=$2
  write_config "# Written by infra/deploy/setup-tunnel.sh: the link to the production server.
[Interface]
Address = $worker_address/24
PrivateKey = $(cat "$key_file")

[Peer]
# The production server, $peer_ip
PublicKey = $peer_key
Endpoint = $peer_ip:$port
AllowedIPs = $production_address/32
# Keeps the link open from this side, so production never has to reach in.
PersistentKeepalive = 25"

  echo "The link is up on this side. Check it reaches production:"
  echo "  ping -c 3 $production_address"
}

main() {
  [[ -n $root || $(id -u) == 0 ]] || { echo "Run as root (sudo bash $0 ...)." >&2; exit 1; }
  local step=${1:-}
  case $step in
    key)
      [[ $# == 1 ]] || usage
      make_key
      echo "This server's public key, for the other server's step:"
      wg pubkey < "$key_file"
      ;;
    production|worker)
      [[ $# == 3 ]] || usage
      valid_ip "$2" || { echo "Not an IPv4 address: $2" >&2; exit 2; }
      valid_key "$3" || { echo "Not a WireGuard public key: $3" >&2; exit 2; }
      [[ -s $key_file ]] || { echo "Run 'bash $0 key' on this server first." >&2; exit 1; }
      [[ $3 != "$(wg pubkey < "$key_file")" ]] || { echo "That is this server's own key; give the other server's." >&2; exit 2; }
      "$step" "$2" "$3"
      ;;
    *) usage ;;
  esac
}

main "$@"
