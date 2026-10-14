# Deploying staging: staging.heynaija.ng

Staging runs on the **Contabo server that already hosts Koinovera staging**. The
two share the server and nothing else: separate GitHub repositories and runners,
separate containers, networks, volumes and databases, and separate nginx sites.
Production is on its own netcup server: [production.md](production.md).

```text
Browser ── Cloudflare (TLS, cache, CSAM scanning) ──> Contabo server :443, the host's nginx
   ├── staging.koinovera.com …                  ──> Koinovera (127.0.0.1:3001, :8000, :4433)
   └── staging.heynaija.ng
         ├── /media/*  ──> R2 media bucket (media-staging.heynaija.ng)
         └── the rest  ──> 127.0.0.1:3100, HeyNaija's web app ──> api, kratos, postgres, redis
                                                         (a private Docker network, no host ports)
```

**How a deploy happens:** a push to the `staging` branch runs CI; if it passes,
GitHub's machines build the two images and push them to GitHub's container
registry, tagged with the commit; then HeyNaija's runner on the server pulls them
and restarts HeyNaija with `infra/deploy/deploy.sh`. The server never builds
anything, so Koinovera never competes with a build for memory.

**Tested** on a laptop (14 October 2026): the images, the stack, the nginx site on
nginx 1.24 (Ubuntu 24.04's version) with client certificates, an invite signup
with a verification email, and a backup and restore. **Not tested:** Cloudflare,
R2, Resend, GitHub Actions and the runner, which need the real accounts.

## How HeyNaija stays out of Koinovera's way

- **Ports.** Only one port is published on the host: the web app on
  `127.0.0.1:3100` (`WEB_PORT`), for nginx. Postgres, Redis, Kratos and the API
  publish nothing; their ports exist only inside HeyNaija's own Docker network, so
  they cannot clash with Koinovera's Kratos on 4433 or anything else.
- **Names.** `COMPOSE_PROJECT_NAME=heynaija-staging` prefixes every container,
  network and volume.
- **nginx.** HeyNaija adds one site file, `heynaija-staging.conf`, answering only
  for `staging.heynaija.ng`. `install-nginx.sh` puts the previous file back if
  `nginx -t` fails, so a mistake never reaches Koinovera's sites.
- **Do not run `setup-server.sh` here.** It is for a fresh server: it rewrites SSH
  and firewall settings and restarts Docker, which would restart Koinovera.
- **One Docker daemon.** Any user in the `docker` group can manage every container
  on the server, Koinovera's included. Fine while both projects are yours.

## 1. Cloudflare

`heynaija.ng` is on Cloudflare.

1. **DNS:** `A` record `staging` → the Contabo server's IPv4, **Proxied**. (`AAAA`
   too, if the server has IPv6.)
2. **SSL/TLS → Overview:** **Full (strict)**. **Edge Certificates:** Always Use HTTPS
   on, minimum TLS 1.2.
3. **SSL/TLS → Origin Server → Create Certificate** for `heynaija.ng` and
   `*.heynaija.ng`, 15 years (one certificate then covers staging and production).
   Save it as `heynaija-origin.pem` and the key as `heynaija-origin-key.pem`; the key
   is shown once. Koinovera's origin certificate is for `koinovera.com` and does not
   cover these names.
4. **Authenticated Origin Pulls → Global: On.** Download Cloudflare's CA:
   <https://developers.cloudflare.com/ssl/static/authenticated_origin_pull_ca.pem>.
   Turning this on also makes Cloudflare present the certificate to Koinovera's
   origin; Koinovera's nginx does not ask for it, so nothing changes there.

## 2. R2 and Resend

Already done. Check against [cloudflare-r2.md](cloudflare-r2.md): the media
bucket's custom domain is `media-staging.heynaija.ng`, its CORS origin is
`https://staging.heynaija.ng`, and the uploads bucket's lifecycle rules cover only
`avatars/` and `posts/`, never `quarantine/`. Note which domain you verified in
Resend: `SMTP_FROM_ADDRESS` must be on it.

For backups, make sure there is a `heynaija-backups` bucket and an R2 token
limited to it (Object Read & Write), separate from the app's token.

## 3. The server

As your usual admin user on the Contabo server. First check there is room
(HeyNaija staging needs about 1.5 GB of memory and a few GB of disk):

```bash
free -h && df -h /
```

A user for HeyNaija, its folder, and the tools it needs (most are probably there):

```bash
sudo useradd --create-home --shell /bin/bash --groups docker heynaija
```

```bash
sudo install -d -o heynaija -g heynaija /srv/heynaija
```

```bash
sudo apt-get install -y age rclone gettext-base
```

The Cloudflare files from step 1, beside Koinovera's:

```bash
sudo install -m 644 heynaija-origin.pem authenticated_origin_pull_ca.pem /etc/ssl/cloudflare/
```

```bash
sudo install -m 600 heynaija-origin-key.pem /etc/ssl/cloudflare/
```

## 4. GitHub

1. Push this repository to a private GitHub repository and create the `staging`
   branch (and `main`).
2. **Settings → Environments:** create `staging` (and `production` later).
3. **Read access for the server:** as `heynaija` on the server, make a key and add
   it under **Settings → Deploy keys** (read-only):

   ```bash
   sudo -u heynaija mkdir -p -m 700 /home/heynaija/.ssh
   ```

   ```bash
   sudo -u heynaija ssh-keygen -t ed25519 -N "" -C heynaija-staging -f /home/heynaija/.ssh/id_ed25519
   ```

   (`sudo -u`, not `sudo -iu`: a login shell drops the empty `""` passphrase.)

   ```bash
   sudo cat /home/heynaija/.ssh/id_ed25519.pub
   ```

4. **The runner:** **Settings → Actions → Runners → New self-hosted runner**, Linux
   x64. Run GitHub's download commands as `heynaija` in `/home/heynaija/actions-runner`,
   and when configuring it give the label and name `heynaija-staging`:

   ```bash
   ./config.sh --url https://github.com/<you>/heynaija --token <token from GitHub> --labels heynaija-staging --name heynaija-staging --unattended
   ```

   Then `exit` back to your admin user (`heynaija` has no password and no sudo) and
   install it as a service that runs as `heynaija`:

   ```bash
   sudo bash -c 'cd /home/heynaija/actions-runner && ./svc.sh install heynaija && ./svc.sh start'
   ```

   It should show as **Idle** under **Settings → Actions → Runners**.

   It sits beside Koinovera's runner without affecting it.

## 5. First deploy

As `heynaija` (`sudo -iu heynaija`):

```bash
git clone git@github.com:<you>/heynaija.git /srv/heynaija
```

```bash
cd /srv/heynaija/infra/deploy && ./gen-env.sh
```

Edit `.env`: `IMAGE_PREFIX=ghcr.io/<your lowercase GitHub name>/heynaija`, the R2
settings (`S3_*`), `SMTP_CONNECTION_URI=smtps://resend:<API key>@smtp.resend.com:465/`,
`SMTP_FROM_ADDRESS`, and `BACKUP_AGE_RECIPIENT` (step 6). The rest is already right
for staging. Keep a copy of the whole file in the password manager.

Install the nginx site, as your admin user (it needs root, and `.env` is readable
only by `heynaija`):

```bash
cd /srv/heynaija/infra/deploy && sudo ./install-nginx.sh
```

Then push to `staging` and watch **Actions** in GitHub. When the deploy job is
green, create the communities and the first invite:

```bash
docker compose run --rm api node node_modules/@heynaija/db/dist/seed.js
```

```bash
docker compose run --rm api node dist/cli/create-invite.js --uses 5 --days 14 --note "staging testers"
```

After signing up, make yourself a site moderator:

```bash
docker compose run --rm api node dist/cli/moderator.js grant <your-handle>
```

## 6. Backups

On **your own computer**, make the key that can read the backups. Keep the file in
the password manager and offline, never on the server:

```bash
age-keygen -o heynaija-backup.key
```

Its public key (`age1…`) goes in `.env` as `BACKUP_AGE_RECIPIENT`. On the server,
as `heynaija`, connect rclone to the backups bucket with the backups-only token:

```bash
rclone config create r2backup s3 provider=Cloudflare access_key_id=<id> secret_access_key=<secret> endpoint=https://<ACCOUNT_ID>.r2.cloudflarestorage.com no_check_bucket=true
```

Run one backup by hand, then schedule it (`crontab -e` as `heynaija`):

```bash
/srv/heynaija/infra/deploy/backup.sh
```

```text
15 3 * * * /srv/heynaija/infra/deploy/backup.sh >> /home/heynaija/backup.log 2>&1
```

Recommended: a free healthchecks.io check expecting a daily ping, its URL in
`BACKUP_PING_URL`, so you hear if backups stop.

Backups cover both databases (members, posts, moderation; accounts, passwords and
sessions). Media lives only in R2.

**Rehearse a restore** before inviting anyone: on a laptop or spare machine with
the same setup and the key, `./restore.sh latest ~/heynaija-backup.key`. It asks
you to type `restore`, replaces both databases and restarts. Then sign in with an
existing account.

## 7. Check it works

- [ ] `https://staging.heynaija.ng` loads; `curl -I` shows `x-robots-tag: noindex`.
- [ ] Koinovera staging still works.
- [ ] Nobody gets in around Cloudflare: from your computer,
      `curl -k --resolve staging.heynaija.ng:443:<server-ip> https://staging.heynaija.ng/`
      returns **400** (no client certificate).
- [ ] Sign up with an invite; the verification email arrives (check spam, and
      Resend's logs); recovery email works.
- [ ] A profile photo and a post with images work: the checks in
      [cloudflare-r2.md](cloudflare-r2.md), step 8.
- [ ] A backup exists in `heynaija-backups/staging/`, and a restore rehearsal worked.
- [ ] An uptime check on `https://staging.heynaija.ng/` (UptimeRobot or Better
      Stack, free) emails you when it is down.

## Day to day

| Task                  | How                                                                                                                                          |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Deploy                | Push or merge to `staging`                                                                                                                   |
| Roll back             | **Actions → Deploy staging → Run workflow** on an earlier commit's branch or tag, or on the server: `./deploy.sh <commit from releases.log>` |
| Status                | `docker compose ps` in `/srv/heynaija/infra/deploy`                                                                                          |
| Logs                  | `docker compose logs -f --tail 100 api` (or `web`, `kratos`)                                                                                 |
| Invite people         | `docker compose run --rm api node dist/cli/create-invite.js --uses 5 --days 14`                                                              |
| Change the nginx site | edit `infra/deploy/nginx/heynaija.conf.template`, deploy, then `sudo ./install-nginx.sh`                                                     |

The server keeps the last five releases' images, so a rollback to one of them
needs no registry. For an older one, `deploy.sh` pulls from GitHub's registry,
which needs `docker login ghcr.io` with a token that can read packages. Database
migrations only ever add, so older code keeps working; a migration that removes or
renames something needs its own plan.
