#!/usr/bin/env bash
# Production's video worker on a server of its own, tested without either server:
# setup-tunnel.sh against a scratch directory with stand-ins for the system's
# commands, worker-env.sh on a sample production .env, and the compose files through
# `docker compose config`, which reads them without a Docker daemon. Needs bash 4+,
# jq and the Docker CLI with Compose.
set -euo pipefail
repo_root=$(cd "$(dirname "$0")/../.." && pwd)
deploy=$repo_root/infra/deploy
test_dir=$(mktemp -d)
trap 'rm -rf "$test_dir"' EXIT

# --- setup-tunnel.sh ---------------------------------------------------------

mkdir -p "$test_dir/bin"
for command in apt-get systemctl ufw sysctl iptables; do
  cat > "$test_dir/bin/$command" <<SH
#!/usr/bin/env bash
printf '%s %s\n' "$command" "\$*" >> "\$TUNNEL_TEST_EVENTS"
# The guard's first run finds no rule; later runs find the one it added.
[[ "$command \$*" != 'iptables -t raw -C PREROUTING'* ]] || grep -Fq 'iptables -t raw -I PREROUTING' "\$TUNNEL_TEST_EVENTS"
SH
done
# wg genkey hands out the key in WG_TEST_KEY; a public key is its private key in rot13.
cat > "$test_dir/bin/wg" <<'SH'
#!/usr/bin/env bash
case $1 in
  genkey) printf '%s\n' "$WG_TEST_KEY" ;;
  pubkey) tr 'A-Za-z' 'N-ZA-Mn-za-m' ;;
  *) exit 1 ;;
esac
SH
chmod +x "$test_dir/bin/"*
export PATH="$test_dir/bin:$PATH"

production_key=aB3dE5gH7jK9mN1pQ3sT5vW7yZ9bC1eF3hJ5kL7nPq8=
worker_key=Zx8wV6uT4sR2qP0oN8mL6kJ4iH2gF0eD8cB6aZ4yXwc=

server() {
  local name=$1
  export TUNNEL_TEST_ROOT="$test_dir/$name" TUNNEL_TEST_EVENTS="$test_dir/$name.events"
  mkdir -p "$TUNNEL_TEST_ROOT/etc/sysctl.d" "$TUNNEL_TEST_ROOT/etc/systemd/system" "$TUNNEL_TEST_ROOT/usr/local/sbin"
  touch "$TUNNEL_TEST_EVENTS"
}
tunnel() { bash "$deploy/setup-tunnel.sh" "$@"; }
public() { printf '%s\n' "$1" | wg pubkey; }
refused() {
  local why=$1; shift
  if tunnel "$@" > "$test_dir/refused.out" 2>&1; then
    echo "FAIL: setup-tunnel.sh $* succeeded" >&2; exit 1
  fi
  grep -Fq "$why" "$test_dir/refused.out" || { cat "$test_dir/refused.out"; exit 1; }
}

server production
refused 'on this server first' production 203.0.113.7 "$worker_key"
WG_TEST_KEY=$production_key tunnel key > "$test_dir/production.key.out"
[[ $(tail -n 1 "$test_dir/production.key.out") == "$(public "$production_key")" ]]
[[ $(stat -c %a "$TUNNEL_TEST_ROOT/etc/wireguard/heynaija.key" 2>/dev/null || stat -f %Lp "$TUNNEL_TEST_ROOT/etc/wireguard/heynaija.key") == 600 ]]
# A second `key` keeps the first key.
WG_TEST_KEY=another tunnel key > /dev/null
[[ $(cat "$TUNNEL_TEST_ROOT/etc/wireguard/heynaija.key") == "$production_key" ]]
echo "PASS: tunnel-key"

refused 'Not an IPv4 address' production example.com "$worker_key"
refused 'Not a WireGuard public key' production 203.0.113.7 not-a-key
refused "this server's own key" production 203.0.113.7 "$(public "$production_key")"
refused 'bash setup-tunnel.sh key' production 203.0.113.7
[[ ! -e $TUNNEL_TEST_ROOT/etc/wireguard/heynaija.conf ]]
echo "PASS: tunnel-refuses-bad-input"

for run in 1 2; do
  tunnel production 203.0.113.7 "$worker_key" > /dev/null
done
conf=$TUNNEL_TEST_ROOT/etc/wireguard/heynaija.conf
[[ $(grep -c '^\[Interface\]' "$conf") == 1 ]]
grep -Fxq 'Address = 10.80.0.1/24' "$conf"
grep -Fxq 'ListenPort = 51820' "$conf"
grep -Fxq "PrivateKey = $production_key" "$conf"
grep -Fxq "PublicKey = $worker_key" "$conf"
grep -Fxq 'AllowedIPs = 10.80.0.2/32' "$conf"
! grep -q '^Endpoint' "$conf"
[[ $(stat -c %a "$conf" 2>/dev/null || stat -f %Lp "$conf") == 600 ]]
grep -Fxq 'ufw allow from 203.0.113.7 to any port 51820 proto udp comment HeyNaija tunnel' "$TUNNEL_TEST_EVENTS"
grep -Fxq 'net.ipv4.ip_nonlocal_bind = 1' "$TUNNEL_TEST_ROOT/etc/sysctl.d/60-heynaija-tunnel.conf"
grep -Fxq 'systemctl enable wg-quick@heynaija' "$TUNNEL_TEST_EVENTS"
grep -Fxq 'systemctl restart wg-quick@heynaija' "$TUNNEL_TEST_EVENTS"
grep -Fxq 'systemctl restart heynaija-tunnel-guard' "$TUNNEL_TEST_EVENTS"
grep -Fxq 'Before=docker.service' "$TUNNEL_TEST_ROOT/etc/systemd/system/heynaija-tunnel-guard.service"
echo "PASS: tunnel-production"

# The guard drops what reaches 10.80.0.1 other than through the link or from the
# server itself, and adds its PREROUTING rule once however often it runs.
guard=$TUNNEL_TEST_ROOT/usr/local/sbin/heynaija-tunnel-guard
[[ -x $guard ]] && sh -n "$guard"
: > "$TUNNEL_TEST_EVENTS"
sh "$guard" && sh "$guard"
grep -Fxq 'iptables -t raw -A heynaija-tunnel -i heynaija -j RETURN' "$TUNNEL_TEST_EVENTS"
grep -Fxq 'iptables -t raw -A heynaija-tunnel -i lo -j RETURN' "$TUNNEL_TEST_EVENTS"
grep -Fxq 'iptables -t raw -A heynaija-tunnel -j DROP' "$TUNNEL_TEST_EVENTS"
[[ $(grep -c '^iptables -t raw -I PREROUTING -d 10.80.0.1/32 -j heynaija-tunnel$' "$TUNNEL_TEST_EVENTS") == 1 ]]
echo "PASS: tunnel-guard"

server worker
WG_TEST_KEY=$worker_key tunnel key > /dev/null
tunnel worker 198.51.100.4 "$production_key" > /dev/null
conf=$TUNNEL_TEST_ROOT/etc/wireguard/heynaija.conf
grep -Fxq 'Address = 10.80.0.2/24' "$conf"
grep -Fxq "PrivateKey = $worker_key" "$conf"
grep -Fxq "PublicKey = $production_key" "$conf"
grep -Fxq 'Endpoint = 198.51.100.4:51820' "$conf"
grep -Fxq 'AllowedIPs = 10.80.0.1/32' "$conf"
grep -Fxq 'PersistentKeepalive = 25' "$conf"
! grep -q '^ListenPort' "$conf"
# The worker opens no port: nothing for ufw, no guard.
! grep -q '^ufw ' "$TUNNEL_TEST_EVENTS"
[[ ! -e $TUNNEL_TEST_ROOT/usr/local/sbin/heynaija-tunnel-guard ]]
echo "PASS: tunnel-worker"

# --- worker-env.sh -----------------------------------------------------------

cat > "$test_dir/production.env" <<'ENV'
COMPOSE_PROJECT_NAME=heynaija-production
COMPOSE_FILE=compose.yml:compose.tunnel.yml
DATABASE_TUNNEL_ADDRESS=10.80.0.1
DEPLOY_BRANCH=main
IMAGE_PREFIX=ghcr.io/heynaija/heynaija
SITE_URL=https://heynaija.ng
POSTGRES_PASSWORD=pg-secret
REDIS_PASSWORD=redis-secret
S3_ENDPOINT=https://account.r2.cloudflarestorage.com
S3_ACCESS_KEY_ID=s3-id
S3_SECRET_ACCESS_KEY=s3-secret
S3_UPLOADS_BUCKET=heynaija-uploads
S3_MEDIA_BUCKET=heynaija-media
ARACHNID_SHIELD_USERNAME=shield-user
ARACHNID_SHIELD_PASSWORD=shield-password
SMTP_CONNECTION_URI=smtps://resend:key@smtp.resend.com:465
SMTP_FROM_ADDRESS=hello@heynaija.ng
VIDEO_MAX_SECONDS=60
VIDEO_WORKER_CPUS=2
KRATOS_SECRETS_COOKIE=not-for-the-worker
PUSH_VAPID_PRIVATE_KEY=not-for-the-worker
CLOUDFLARE_PURGE_TOKEN=not-for-the-worker
LIVEKIT_API_SECRET=not-for-the-worker
ENV
WORKER_ENV_SOURCE="$test_dir/production.env" bash "$deploy/worker-env.sh" > "$test_dir/worker.env"
for line in COMPOSE_PROJECT_NAME=heynaija-video-worker COMPOSE_FILE=compose.worker.yml DEPLOY_ROLE=video-worker \
  DATABASE_TUNNEL_ADDRESS=10.80.0.1 VIDEO_WORKER_CPUS=4 DEPLOY_BRANCH=main IMAGE_PREFIX=ghcr.io/heynaija/heynaija \
  POSTGRES_PASSWORD=pg-secret REDIS_PASSWORD=redis-secret S3_SECRET_ACCESS_KEY=s3-secret \
  ARACHNID_SHIELD_PASSWORD=shield-password SMTP_FROM_ADDRESS=hello@heynaija.ng VIDEO_MAX_SECONDS=60; do
  grep -Fxq "$line" "$test_dir/worker.env" || { echo "FAIL: worker.env lacks $line" >&2; cat "$test_dir/worker.env"; exit 1; }
done
! grep -Fq not-for-the-worker "$test_dir/worker.env"
# Each setting once.
[[ -z $(grep -oE '^[A-Z0-9_]+=' "$test_dir/worker.env" | sort | uniq -d) ]]
grep -v '^DATABASE_TUNNEL_ADDRESS=' "$test_dir/production.env" > "$test_dir/no-tunnel.env"
if WORKER_ENV_SOURCE="$test_dir/no-tunnel.env" bash "$deploy/worker-env.sh" > /dev/null 2>&1; then
  echo "FAIL: worker-env.sh ran before the tunnel was set up" >&2; exit 1
fi
echo "PASS: worker-env"

# --- The compose files ---------------------------------------------------------

# The worker's environment is the same list in both files.
env_keys() {
  awk '
    /^  video-worker:$/ { service = 1; next }
    service && /^  [a-z]/ { exit }
    service && /^    environment:$/ { env = 1; next }
    env && /^      [A-Z0-9_]+:/ { sub(/^ +/, ""); sub(/:.*/, ""); print; next }
    env && /^    [a-z]/ { exit }
  ' "$1" | sort
}
diff <(env_keys "$deploy/compose.yml") <(env_keys "$deploy/compose.worker.yml")
[[ $(env_keys "$deploy/compose.worker.yml" | wc -l) -gt 20 ]]
echo "PASS: worker-environment-matches"

config() { docker compose --project-directory "$deploy" "$@" config --format json; }

# The worker's server, with the .env worker-env.sh wrote: the worker alone, reaching
# production over the link.
printf 'RELEASE=0123abc\n' >> "$test_dir/worker.env"
config -f "$deploy/compose.worker.yml" --env-file "$test_dir/worker.env" > "$test_dir/worker.json"
[[ $(jq -r '.services | keys | join(" ")' "$test_dir/worker.json") == video-worker ]]
jq -e '.services["video-worker"].environment.DATABASE_URL == "postgres://heynaija:pg-secret@10.80.0.1:5432/heynaija"' "$test_dir/worker.json" > /dev/null
jq -e '.services["video-worker"].environment.REDIS_URL == "redis://:redis-secret@10.80.0.1:6379"' "$test_dir/worker.json" > /dev/null
jq -e '.services["video-worker"].image == "ghcr.io/heynaija/heynaija-video-worker:0123abc"' "$test_dir/worker.json" > /dev/null
jq -e '.services["video-worker"] | .cpus == 4 and .read_only == true and .cap_drop == ["ALL"] and (.ports // [] | length) == 0' "$test_dir/worker.json" > /dev/null
echo "PASS: worker-compose"

# Production: Postgres and Redis published on the link's address with
# compose.tunnel.yml, and on nothing without it.
grep -oE '\$\{[A-Z0-9_]+:\?' "$deploy/compose.yml" | cut -c3- | tr -d ':?' | sort -u | sed 's/$/=test/' > "$test_dir/production-config.env"
printf 'DATABASE_TUNNEL_ADDRESS=10.80.0.1\n' >> "$test_dir/production-config.env"
config -f "$deploy/compose.yml" -f "$deploy/compose.tunnel.yml" --env-file "$test_dir/production-config.env" > "$test_dir/tunnel.json"
for service in postgres:5432 redis:6379; do
  name=${service%%:*} port=${service#*:}
  jq -e --arg s "$name" --arg p "$port" \
    '.services[$s].ports == [{"mode": "ingress", "host_ip": "10.80.0.1", "target": ($p | tonumber), "published": $p, "protocol": "tcp"}]' \
    "$test_dir/tunnel.json" > /dev/null || { jq ".services.$name.ports" "$test_dir/tunnel.json"; exit 1; }
done
# Nothing else gains a port: only the web app's loopback one, as before.
[[ $(jq '[.services[] | .ports // [] | .[]] | length' "$test_dir/tunnel.json") == 3 ]]
config -f "$deploy/compose.yml" --env-file "$test_dir/production-config.env" > "$test_dir/plain.json"
jq -e '(.services.postgres.ports // []) == [] and (.services.redis.ports // []) == []' "$test_dir/plain.json" > /dev/null
echo "PASS: tunnel-compose"
