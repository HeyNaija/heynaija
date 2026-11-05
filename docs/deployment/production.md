# Deploying production: heynaija.ng

Production runs alone on a **netcup** server. It works exactly like staging (read
[staging.md](staging.md) first): the same images, Compose file, nginx template,
scripts and backups, with production settings, and deployed by pushes to `main`.

**How a deploy happens:** a release is a merge from `staging`, whose code is
already running on staging. The production workflow finds staging's images by the
code's tree (`staged-<tree>`, tagged once the staging deploy succeeds), tags them
with the `main` commit in the registry, and deploys them, without running CI or
building again, so production runs exactly what ran on staging. Code staging is
not running (a fix made on `main`, or a merge into a `main` that has changes
staging lacks) has no such images: it must pass CI, including the browser tests,
and is built first, as on staging.

**Do not launch publicly** until the launch rule in PLAN.md §11 holds and the
checklist in [docs/safety/abuse-material-scanning.md](../safety/abuse-material-scanning.md)
is done.

## 1. The server

netcup **RS 2000** (8 dedicated cores, 16 GB RAM, 256 GB NVMe) or larger, **Ubuntu
24.04**. `compose.yml`'s defaults are sized for it (Postgres's memory settings, 20
database connections), and step 5 sets 4 web server processes (`WEB_WORKERS`),
each rendering pages on its own core while the other cores serve Postgres, the
API and Kratos. Dedicated cores matter: page rendering and Postgres are both
CPU-bound. Then, from your
computer (use your own public key file):

```bash
scp infra/deploy/setup-server.sh root@<server-ip>:
```

```bash
ssh root@<server-ip> "bash setup-server.sh '$(cat ~/.ssh/id_ed25519.pub)'"
```

It installs Docker and nginx, creates the `heynaija` user (with sudo; it is the
admin account), turns off password and root SSH logins, and enables the firewall
and automatic security updates. **Check `ssh heynaija@<server-ip>` works in a second
terminal before closing the root session.** The provider's web console still works
if you lock yourself out.

A server set up before 25 October 2026 lacks one part of the script: systemd
restarting nginx when it fails to start. (On 23 October nginx failed to come back
after the security updates restarted it, and the site was down until someone
started it by hand.) Add it once, as `heynaija`:

```bash
sudo install -d /etc/systemd/system/nginx.service.d && printf '[Unit]\nStartLimitIntervalSec=0\n\n[Service]\nRestart=on-failure\nRestartSec=10s\n' | sudo tee /etc/systemd/system/nginx.service.d/restart.conf && sudo systemctl daemon-reload
```

## 2. Cloudflare

1. **DNS:** `A` record `heynaija.ng` (`@`) → the netcup server, **Proxied**; `AAAA` if
   it has IPv6. Optionally `www` redirecting to `heynaija.ng`.
2. The origin certificate from staging step 1 covers `heynaija.ng`. Copy it, its
   key and the origin-pull CA into `/etc/ssl/cloudflare/` (as in staging step 3).
3. **Authenticated Origin Pulls: use the zone-level option** for production, with a
   certificate you create, instead of the global one. The global certificate proves
   a request came through Cloudflare, but anyone's Cloudflare account could send
   it; the zone-level one proves it came through yours. Cloudflare's guide:
   "Authenticated Origin Pulls → Set up → Zone-level". Point `NGINX_CLIENT_CA` at
   the CA you used.

## 3. R2 and email

- Buckets `heynaija-uploads` and `heynaija-media` (custom domain `media.heynaija.ng`,
  CORS origin `https://heynaija.ng`), set up as in [cloudflare-r2.md](cloudflare-r2.md),
  with a production-only app token.
- Backups go to the same `heynaija-backups` bucket under `production/`; give
  production its own backups-only token.
- Resend: the same sending domain; a separate API key for production, so either can
  be revoked alone.

## 4. GitHub

Same as staging step 4, with:

- the `production` environment, usable only from `main` (staging step 4.4, with
  `production` and `main`). A public repository can also require a reviewer before
  each deploy: **Settings → Environments → production → Required reviewers**;
- the deploy job's SSH key of its own (`deploy-job-production`), and the
  `production` environment's `DEPLOY_SSH_KEY`, `DEPLOY_HOST` and
  `DEPLOY_KNOWN_HOSTS`, as in staging step 4.4. Here `heynaija` is also the admin
  account: the forced-command line goes beside your own key in its
  `authorized_keys`, and your key stays as it is;
- the netcup server's own deploy key (deploy keys are already allowed for the
  organization once staging is set up).

Staging's [status table](staging.md#status-14-october-2026) lists what went wrong
there; each fix is in the steps, so follow them exactly.

## 5. First deploy

As `heynaija`, clone to `/srv/heynaija`, put the deploy job's script in place and
check its key (staging step 5), run `./gen-env.sh`, and edit `.env`:

| Setting | Production |
|---|---|
| `COMPOSE_PROJECT_NAME` | `heynaija-production` |
| `DEPLOY_BRANCH` | `main` |
| `APP_ENV` | `production` (also what an unset value means). Feature flags start from their production defaults ([feature-flags.md](../feature-flags.md)) |
| `SITE_URL` | `https://heynaija.ng` |
| `SITE_ADDRESS` | `heynaija.ng` |
| `ROBOTS` | `index` |
| `MEDIA_ORIGIN` | `https://media.heynaija.ng` |
| `S3_UPLOADS_BUCKET` / `S3_MEDIA_BUCKET` | `heynaija-uploads` / `heynaija-media` |
| `BACKUP_DESTINATION` | `r2backup:heynaija-backups/production` |
| `IMAGE_PREFIX` | `ghcr.io/heynaija/heynaija`, lower case, as for staging |
| `COMPOSE_PROFILES` | Unset: production's video worker runs on a server of its own (section 7), not here |
| `S3_*`, `SMTP_*`, `BACKUP_AGE_RECIPIENT` | as for staging, with production's tokens and keys |
| `PUSH_VAPID_*` | made by `gen-env.sh`, production's own: never staging's. Keep a copy; a new pair cuts off every browser that turned push on ([ADR 0011](../adr/0011-push-notifications.md)) |
| `POSTGRES_*`, `DATABASE_POOL_MAX` | delete these lines: `compose.yml`'s defaults are sized for this 16 GB server |
| `WEB_WORKERS` | `4` |
| `MIGRATE_LOCK_TIMEOUT_MS` | optional: how long a migration waits for a table lock before the migrate step retries and then fails the deploy (default 5000, `0` waits forever). Raise it if a needed `ALTER` on a busy table keeps timing out |

Then check no `<…>` placeholder is left: `grep -n '^[^#]*<' .env` prints nothing.

`WEB_PORT=3100` is fine: nothing else runs on this server. Then:

```bash
cd /srv/heynaija/infra/deploy && ./install-nginx.sh
```

Merge to `main` and watch **Actions → Deploy production**. Then seed, invite and
grant moderators as in staging step 5.

## 6. Backups and checks

Backups exactly as staging step 6, with production's token and the same age key
(or a separate one). **Rehearse a restore of production's backup** before launch.

Then every check in staging step 7, except that `curl -I https://heynaija.ng` must
**not** show `x-robots-tag`, and add an uptime check for `https://heynaija.ng/`.

## 7. The video worker's server

Production's video worker runs on a server of its own, a netcup **RS 1000** (4
dedicated cores, 8 GB, Ubuntu 26.04), so encoding never takes cores from the site
([ADR 0021](../adr/0021-video-hls-on-r2.md) section 5). It reaches production's
Postgres and Redis over a private WireGuard link, and nothing else of production's:
not Kratos, the API or the web app. It runs `compose.worker.yml`, that one service.
Video stays off for members until ADR 0021's launch gate; the worker can run before
then, with nothing to do.

How the link works: production listens on UDP 51820 to the worker's address alone;
the worker connects out and keeps it open, so it opens no port. On the link
production is `10.80.0.1` and the worker `10.80.0.2`, and production publishes
Postgres and Redis on `10.80.0.1` only (`compose.tunnel.yml`). Docker's published
ports bypass ufw, so `setup-tunnel.sh` also drops any packet for `10.80.0.1` that did
not come through the link, and lets Docker publish on that address while the link is
down, so that a broken link can never stop Postgres starting.

1. **Set the server up.** From your computer (use your own public key file):

   ```bash
   scp infra/deploy/setup-server.sh root@<worker-ip>:
   ```

   ```bash
   ssh root@<worker-ip> "bash setup-server.sh --worker '$(cat ~/.ssh/id_ed25519.pub)'"
   ```

   As for production (section 1), but without nginx, and the firewall lets in SSH
   alone. **Check `ssh heynaija@<worker-ip>` works in a second terminal before closing
   the root session.** Then, as `heynaija` on the worker:

   ```bash
   git clone https://github.com/HeyNaija/heynaija.git /srv/heynaija
   ```

2. **The link.** As `heynaija`, on both servers, which prints each one's public key:

   ```bash
   sudo bash /srv/heynaija/infra/deploy/setup-tunnel.sh key
   ```

   On production, with the worker's public IP and key:

   ```bash
   sudo bash /srv/heynaija/infra/deploy/setup-tunnel.sh production <worker-ip> <worker's key>
   ```

   On the worker, with production's public IP and key, then check it answers:

   ```bash
   sudo bash /srv/heynaija/infra/deploy/setup-tunnel.sh worker <production-ip> <production's key>
   ```

   ```bash
   ping -c 3 10.80.0.1
   ```

3. **Publish Postgres and Redis on the link.** Add these two lines to production's
   `infra/deploy/.env`:

   ```
   COMPOSE_FILE=compose.yml:compose.tunnel.yml
   DATABASE_TUNNEL_ADDRESS=10.80.0.1
   ```

   Then deploy the release production already runs. **This restarts Postgres and
   Redis**, which Compose recreates to publish them, so the site pauses for a few
   seconds: do it at a quiet hour.

   ```bash
   cd /srv/heynaija/infra/deploy && ./deploy.sh "$(git rev-parse HEAD)"
   ```

   From the worker, both must print `open`:

   ```bash
   for port in 5432 6379; do timeout 3 bash -c "</dev/tcp/10.80.0.1/$port" && echo "$port open"; done
   ```

4. **The worker's settings**, made from production's `.env` and sent straight
   across, so its secrets never show on a screen. From your computer:

   ```bash
   ssh heynaija@<production-ip> /srv/heynaija/infra/deploy/worker-env.sh | ssh heynaija@<worker-ip> 'umask 077 && cat > /srv/heynaija/infra/deploy/.env'
   ```

   It holds the database and Redis passwords, the storage keys, Arachnid Shield's
   login and the email settings: what `compose.worker.yml` reads, and no Kratos,
   push, LiveKit or Cloudflare secrets. To change one later, change it on production
   and run this again.

5. **Deploys.** The production workflow deploys the worker after production, with
   production's deploy key. On the worker, as `heynaija`, add that key's line from
   production's `authorized_keys`, forced command and all, and put the script it runs
   in place:

   ```bash
   ssh heynaija@<production-ip> "grep -F ssh-deploy.sh ~/.ssh/authorized_keys" | ssh heynaija@<worker-ip> 'cat >> ~/.ssh/authorized_keys'
   ```

   ```bash
   install -m 700 /srv/heynaija/infra/deploy/ssh-deploy.sh ~/ssh-deploy.sh
   ```

   Then give GitHub's `production` environment the worker's address and host key,
   from this repository's folder, and check the fingerprint as in staging step 4:

   ```bash
   gh secret set VIDEO_WORKER_HOST --env production --body '<worker-ip>'
   ```

   ```bash
   ssh-keyscan -t ed25519 <worker-ip> | gh secret set VIDEO_WORKER_KNOWN_HOSTS --env production
   ```

   (`VIDEO_WORKER_SSH_PORT` too, if SSH is not on port 22.) Until `VIDEO_WORKER_HOST`
   is set, the workflow's "Deploy the video worker" job does nothing.

6. **First deploy.** Run **Actions → Deploy production → Run workflow** on `main`, or
   wait for the next release, and watch its second job. Then, on the worker:

   ```bash
   cd /srv/heynaija/infra/deploy && docker compose ps && docker compose logs --tail 20 video-worker
   ```

   It should be running and waiting for jobs. To roll back, run
   `./deploy.sh <commit>` on each server, production first.

Before video opens in production, ADR 0021's launch gate also needs a 3-minute 4K
clip and a 1 GB file through this worker and Arachnid Shield. When clips start to
queue, upgrade the server to an RS 2000 in netcup's control panel (it keeps the
data), run step 4 again with `worker-env.sh 8` for its 8 cores, and deploy.
