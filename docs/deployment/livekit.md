# LiveKit for Gists: rtc-staging.heynaija.ng

Gists (live audio rooms, [ADR 0017](../adr/0017-calls-and-meetings.md)) need a
media server. It is LiveKit, self-hosted on a small server of its own: not on the
staging box (memory-tight, shared with Koinovera) and not behind Cloudflare, whose
proxy cannot carry WebRTC. This page is the staging one; production gets a second
server when the beta leaves the allow-list (ADR 0017 section 2, one server per
environment).

Everything for the server is in [`infra/livekit/`](../../infra/livekit): the Compose
file with both configs, `.env.example`, `gen-env.sh` and `setup-server.sh`. The
server holds nothing worth backing up: its config is in the repo and its keys can
be made again (step 6).

```
Browser ──wss://rtc-staging (443)──> Caddy ──> LiveKit :7880   signalling
Browser ──UDP 7882, TCP 7881────────────────> LiveKit          media
Browser ──turn-staging: TLS on 443 (Caddy), UDP 3478──> LiveKit's TURN   when UDP is blocked
API ─────https://rtc-staging (443)──> Caddy ──> LiveKit        rooms, permissions
LiveKit ─https://staging.heynaija.ng/api/internal/livekit/webhook──> Cloudflare ──> nginx
         (only from LIVEKIT_WEBHOOK_FROM) ──> web ──> API /internal/livekit/webhook
```

The webhook goes through Cloudflare like every other request, so the staging
server's own address stays hidden. nginx lets only the LiveKit server's address
post it, and the API checks LiveKit's signature as well.

## 1. Buy the server

**Contabo Cloud VPS 10** (about 4 vCPU, 8 GB RAM, a 200 Mbit/s port and 32 TB of
outbound traffic; check the order page, the terms change), region **European
Union**, image **Ubuntu 24.04**, with your SSH key. No add-ons. For staging this
is far more than needed: the ADR's estimate for 200 listeners and three speakers
is about 30 Mbit/s. Where production goes is still open (ADR 0017 open question 2:
measure from Lagos first).

Note its IPv4 address (and IPv6, if it has one).

## 2. DNS

In Cloudflare, `heynaija.ng` → DNS, two records, both **DNS only (grey cloud)**:

| Type | Name           | Content         |
| ---- | -------------- | --------------- |
| A    | `rtc-staging`  | the server IPv4 |
| A    | `turn-staging` | the server IPv4 |

(AAAA records too, with the IPv6 address, if the server has one.) An orange
cloud breaks media and Caddy's certificates. Check that both answer with the
server's own address, not Cloudflare's:

```bash
dig +short rtc-staging.heynaija.ng turn-staging.heynaija.ng
```

## 3. Set up the server (once, as root)

From the repo on your laptop, with the key you will log in with:

```bash
scp infra/livekit/setup-server.sh root@<server-ip>:/root/
```

```bash
ssh root@<server-ip> "bash /root/setup-server.sh '$(cat ~/.ssh/id_ed25519.pub)'"
```

Read the script first. It installs Docker, makes a `heynaija` user with that key,
turns off password and root logins, raises the UDP buffers LiveKit asks for, and
opens only these ports (ufw): 22, 80 and 443 TCP, 7881 TCP, 7882 UDP and 3478 UDP.
From here on, log in as `heynaija@<server-ip>`.

## 4. Start LiveKit

```bash
ssh heynaija@<server-ip>
git clone https://github.com/HeyNaija/heynaija.git /srv/heynaija/repo
cd /srv/heynaija/repo/infra/livekit
./gen-env.sh
docker compose up -d
docker compose logs -f
```

`gen-env.sh` makes the keys and prints, once, the lines the API needs (step 5):
copy them somewhere safe for a minute, then clear the terminal. The domains,
webhook URL and Let's Encrypt address in `.env` default to staging's; change them
there for another environment.

In the logs, look for `starting LiveKit server` and, from Caddy, a certificate
obtained for each of the two names (within a minute or two of the DNS records
existing). Then, from your laptop:

```bash
curl https://rtc-staging.heynaija.ng
```

answers `OK`.

## 5. Turn Gists on in staging

On the staging server, as your admin user, in `/srv/heynaija/infra/deploy/.env`,
add the lines `gen-env.sh` printed and the switches:

```
CALLS_ENABLED=true
CALLS_GISTS_ENABLED=true
CALLS_MEMBERS=<handles allowed to use Gists, comma-separated>
LIVEKIT_URL=wss://rtc-staging.heynaija.ng
LIVEKIT_API_KEY=...
LIVEKIT_API_SECRET=...
LIVEKIT_WEBHOOK_KEY=...
LIVEKIT_WEBHOOK_SECRET=...
LIVEKIT_WEBHOOK_FROM=<the LiveKit server's IPv4>[,<its IPv6>]
```

`LIVEKIT_WEBHOOK_FROM` is for nginx: comma-separated, no spaces. Then, in
`/srv/heynaija/infra/deploy`:

```bash
./deploy.sh
```

```bash
sudo ./install-nginx.sh
```

The deploy restarts the API with the new settings; the nginx site gets the
webhook location and allows the microphone. Both are needed: without the second,
the site's `Permissions-Policy` still blocks every microphone.

## 6. Check it works

- [ ] From the LiveKit server, the webhook path reaches the API and is refused for
      its signature, not by Cloudflare or nginx:
      `curl -s -o /dev/null -w '%{http_code}\n' -X POST -H 'Content-Type: application/webhook+json' -d '{}' https://staging.heynaija.ng/api/internal/livekit/webhook`
      prints **401**. From your laptop the same command prints **403** (nginx).
- [ ] Signed in as a handle in `CALLS_MEMBERS`, Home shows **Start a Gist**. Go
      live; a second member (another phone, on mobile data) joins and hears you.
- [ ] The listener taps **Request to speak**, the host taps **Let speak**, and the
      listener's microphone works. **Mute**, **To listeners** and **Remove** work.
- [ ] Airplane mode on the listener's phone for ten seconds: the room says
      Reconnecting and the sound comes back.
- [ ] The host closes the tab: within three minutes the Gist ends for everyone
      (two minutes' grace, then the next once-a-minute reconcile).
- [ ] On a laptop with UDP blocked, the room still connects (TURN on 443).
- [ ] LiveKit's `participant_joined` webhook arrives for listeners, who join
      hidden; that was never verified. Only that webhook records a connection id,
      so with a Gist live, on staging in `/srv/heynaija/infra/deploy`:
      `docker compose exec postgres psql -U heynaija -d heynaija -c "select role, connection_sid is not null as webhook_seen from gist_members where left_at is null"`
      shows `t` for each listener. If it shows `f`, the reconcile still puts
      presence right within a minute, but record it in ADR 0017.
- [ ] A member not in `CALLS_MEMBERS` sees no Start card, and `/gists/new` is the
      normal not-found page.

## Day to day

| Task                | How                                                                                                                            |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Status              | `docker compose ps` in `/srv/heynaija/repo/infra/livekit`                                                                      |
| Logs                | `docker compose logs -f --tail 100 livekit` (or `caddy`)                                                                       |
| Update              | `git pull` in `/srv/heynaija/repo`, then `docker compose up -d` in `infra/livekit`: a new image or config restarts LiveKit      |
| Upgrade LiveKit     | change the image tag in `infra/livekit/compose.yml` (and `infra/compose/docker-compose.dev.yml`) in a PR, test it, then update |
| New keys            | empty the four keys in `.env`, `./gen-env.sh`, `docker compose up -d`, then the new lines in staging's `.env` and `./deploy.sh` |
| Turn Gists off      | `CALLS_GISTS_ENABLED=false` in staging's `.env`, then `./deploy.sh`: every Gists route answers 404 again                       |
| Remove the server   | Gists off first, then cancel it at Contabo and delete the two DNS records                                                      |

A restart drops every live Gist's media for a few seconds; members' rooms
reconnect by themselves. Do it when nobody is in one.
