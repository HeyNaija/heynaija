# Deploying staging: staging.heynaija.ng

Staging runs on the **Contabo server that already hosts Koinovera staging**. The
two share the server and nothing else: separate GitHub repositories, separate
containers, networks, volumes and databases, and separate nginx sites.
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
GitHub's machines build the API, web and authentication images and push them to GitHub's container
registry, tagged with the commit; then a job on GitHub's machines connects to the
server over SSH with a key that can do one thing there: deploy a commit that is on
`staging` (`infra/deploy/ssh-deploy.sh`), which pulls the images and restarts
HeyNaija with `infra/deploy/deploy.sh`. There is no GitHub runner on the server:
the repository is public, and anyone's pull request could run code on a runner
registered to it. The server never builds
anything, so Koinovera never competes with a build for memory. Kratos uses the
version-pinned HeyNaija image that enforces the Google account policy. That image
is tagged with the contents of `infra/kratos` rather than the commit, so Kratos
restarts only when those files or its configuration change: `deploy.sh` also
labels it with a hash of its rendered configuration, so mounted files cannot
remain stale.

Once the site answers, a last job also tags the API and web images
`staged-<tree>`, with the tree of the code rather than the commit. Merging staging
into `main` makes a new commit with the same tree, so production finds those tags
and deploys the images staging is running, without testing or building that code
again ([production.md](production.md)).

`ssh-deploy.sh` checks out the requested commit before starting its deploy script.
Manual deployments also restart the script if checkout changes it, so upgrades
and rollbacks use the instructions from the requested release.

**Tested** on a laptop (14 October 2026): the images, the stack, the nginx site on
nginx 1.24 (Ubuntu 24.04's version) with client certificates, an invite signup
with a verification email, and a backup and restore.

## Status (14 October 2026)

Staging is **live** at `https://staging.heynaija.ng`: Cloudflare, the origin
certificate and Authenticated Origin Pulls, the nginx site, GitHub Actions with the
runner, images from GitHub's registry, and the first deploy all work. Invite codes
are checked on `/join`.

**Sign-in changed after the first deploy:** members now sign in with an emailed
code or Google, never a password ([ADR 0003](../adr/0003-passwordless-sign-in.md)).
Accounts made before that need the one-off step in
[google-sign-in.md](google-sign-in.md#existing-accounts) once that change is
deployed.

**Handles are unique again:** with that change Kratos stopped checking that a
handle is free, at sign-up or when renaming. Once the fix is deployed, accounts
made or renamed in between need a one-off re-save. First look for handles two
accounts already share (it changes nothing, and lists any it finds):

```bash
cd /srv/heynaija/infra/deploy && docker compose exec -e KRATOS_ADMIN_URL=http://kratos:4434 api node dist/cli/unique-handles.js --check
```

If it lists any, give all but one account of each a new handle; usually the
oldest (listed first) keeps it. Look an account up by the ID it printed:

```bash
docker compose exec api node -e "fetch('http://kratos:4434/admin/identities/<id>').then((r) => r.json()).then((i) => console.log(i.error?.message ?? [i.traits, i.created_at]))"
```

Rename it (3–20 lowercase letters, numbers or underscores, not taken), then
correct the API's copy at once, so profiles and moderator commands stop finding
it under the old handle:

```bash
docker compose exec api node -e "fetch('http://kratos:4434/admin/identities/<id>', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify([{ op: 'replace', path: '/traits/handle', value: '<new handle>' }]) }).then(async (r) => console.log(r.status, (await r.json()).traits?.handle))"
```

```bash
docker compose exec postgres psql -U heynaija -d heynaija -c "update members set handle = '<new handle>' where id = '<id>'"
```

Then run the check again, and without `--check` once it finds none. Running it
again is harmless.

The same release holds a handle given up by renaming for 30 days
([ADR 0004](../adr/0004-handles-held-after-rename.md)).

**Not yet confirmed:** a complete invite signup on staging since the fix below is
deployed, the verification email through Resend, images through R2, backups and a
restore rehearsal, and the uptime check. Work through step 7.

**What went wrong on the way, and is now handled in the steps below:**

| Symptom | Cause | Fix |
| --- | --- | --- |
| GitHub: "Deploy keys — Disabled by HeyNaija" | The organization forbids deploy keys | Step 4.3: allow them in the organization's settings first |
| `zsh: command not found: age-keygen` on a Mac | `age` is not installed | Step 6: `brew install age` |
| `.env: line 39: ACCOUNT_ID: No such file or directory` | A `<…>` placeholder left in `.env`; scripts load it as shell, where `<` reads a file | Step 5: replace every `<…>` |
| Deploy: `repository name (HeyNaija/heynaija-web) must be lowercase` | `IMAGE_PREFIX` had capitals | Step 5: all lower case; `deploy.sh` now lowercases it too |
| Deploy: `cat: ../kratos/policy: Is a directory` | The previous deploy script kept running after checking out a release with the new policy directory | Rerun the failed deploy job: checkout already installed the corrected script. Updated workflows now check out the release before starting it. |
| Browser: `400 Bad Request — No required SSL certificate was sent` | Authenticated Origin Pulls was still off in Cloudflare | Step 1.4 |
| Entering a valid invite code just reloads `/join` | A bug in the web app (fixed in `e88f28a`) | Deploy that commit or later |

## Moving off the self-hosted runner (October 2026)

Until October 2026 a GitHub runner on each server ran the deploy job. A public
repository cannot have one: anyone's pull request can add a workflow that runs on
it, and on this server that is as good as root, with every secret in `.env` and
Koinovera beside it. Deploys now come over SSH (step 4.4). On a server that
already runs HeyNaija, in this order:

1. **Before the repository is made public,** stop the runner and remove it, as
   your admin user. Koinovera's runner is separate; leave it alone.

   ```bash
   sudo bash -c 'cd /home/heynaija/actions-runner && ./svc.sh stop && ./svc.sh uninstall'
   ```

   ```bash
   gh api -X DELETE repos/HeyNaija/heynaija/actions/runners/$(gh api repos/HeyNaija/heynaija/actions/runners --jq '.runners[] | select(.name == "heynaija-staging") | .id')
   ```

   (That one from your computer.) Then, on the server:

   ```bash
   sudo rm -rf /home/heynaija/actions-runner
   ```

2. The deploy job's key and the `staging` environment's secrets: step 4.4.
3. The script, as `heynaija`. The checkout is on a release from before it existed,
   so take it from the `staging` branch:

   ```bash
   git -C /srv/heynaija fetch --quiet origin && git -C /srv/heynaija show origin/staging:infra/deploy/ssh-deploy.sh > ~/ssh-deploy.sh && chmod 700 ~/ssh-deploy.sh
   ```

4. The check and clean-up at the start of step 5 (`ssh … whoami`, then delete the
   key files).
5. Once the change is on `staging` and the repository is public, **Actions →
   Deploy staging → Run workflow** on `staging`.

Production is the same, with `heynaija-production` and the `production`
environment ([production.md](production.md), step 4). For the script, take it
from `origin/staging` there too until a release has brought it to `main`.

## How HeyNaija stays out of Koinovera's way

- **Ports.** Only one port is published on the host: the web app on
  `127.0.0.1:3100` (`WEB_PORT`), for nginx. Postgres, Redis, Kratos and the API
  publish nothing; their ports exist only inside HeyNaija's own Docker network, so
  they cannot clash with Koinovera's Kratos on 4433 or anything else.
- **Feature flags.** Set `APP_ENV=staging` in the server's `.env` (the template says
  `production`, the safe default). Without it staging runs with production's
  defaults: new features are off until an admin turns them on
  ([feature-flags.md](../feature-flags.md)).
- **Names.** `COMPOSE_PROJECT_NAME=heynaija-staging` prefixes every container,
  network and volume.
- **nginx.** HeyNaija adds one site file, `heynaija-staging.conf`, answering only
  for `staging.heynaija.ng`. `install-nginx.sh` puts the previous file back if
  `nginx -t` fails, so a mistake never reaches Koinovera's sites.
- **Do not run `setup-server.sh` here.** It is for a fresh server: it rewrites SSH
  and firewall settings and restarts Docker, which would restart Koinovera.
- **Memory and cores.** `infra/deploy/compose.yml` sizes Postgres for
  production's own 16 GB server (`shared_buffers=4GB`, `effective_cache_size=10GB`,
  `work_mem=16MB`, `maintenance_work_mem=512MB`) and gives the API 20 database
  connections. That is too much for a server shared with Koinovera, so staging's
  `.env` sets smaller values, and one web server process (they are in
  `.env.example`):

  ```ini
  POSTGRES_SHARED_BUFFERS=256MB
  POSTGRES_EFFECTIVE_CACHE_SIZE=768MB
  POSTGRES_WORK_MEM=4MB
  POSTGRES_MAINTENANCE_WORK_MEM=64MB
  DATABASE_POOL_MAX=10
  WEB_WORKERS=1
  ```

  A `.env` made before these settings existed does not have them, and would get
  production's sizes: **add these lines to `/srv/heynaija/infra/deploy/.env`
  before deploying a commit that includes them.**

  One more is optional: `MIGRATE_LOCK_TIMEOUT_MS` (milliseconds, default 5000, `0`
  waits forever) is how long a migration waits for a table lock before the migrate
  step retries and then fails the deploy. Add it to `.env` if a necessary `ALTER`
  on a busy table keeps timing out; left out or empty, the default applies.
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
4. **SSL/TLS → Origin Server → Authenticated Origin Pulls: On** (the zone-wide
   switch, not per-hostname). Download Cloudflare's CA:
   <https://developers.cloudflare.com/ssl/static/authenticated_origin_pull_ca.pem>.
   Turning this on also makes Cloudflare present the certificate to Koinovera's
   origin; Koinovera's nginx does not ask for it, so nothing changes there.
   **If you forget,** the site answers `400 Bad Request — No required SSL
   certificate was sent` through Cloudflare.

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
3. **Read access for the server.** The `HeyNaija` organization blocks deploy keys
   by default, so an organization owner first allows them:
   <https://github.com/organizations/HeyNaija/settings/member_privileges> →
   **Deploy keys** → allow → **Save**. Then, as `heynaija` on the server, make a key
   and add it under the repository's **Settings → Deploy keys → Add deploy key**
   (<https://github.com/HeyNaija/heynaija/settings/keys>), with **Allow write
   access** left off. The server needs it on every deploy: `deploy.sh` fetches the
   commit it deploys.

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

   Paste that whole line (`ssh-ed25519 … heynaija-staging`) as the key. Check it:

   ```bash
   sudo -u heynaija ssh -T git@github.com
   ```

4. **The deploy job's SSH key.** The deploy job logs in as `heynaija` with a key
   that can run one thing: `ssh-deploy.sh`, which deploys a commit on `staging` and
   refuses anything else, whatever the key asks for. Make it on your own computer,
   one per server:

   ```bash
   ssh-keygen -t ed25519 -N "" -C deploy-job-staging -f deploy-job-staging
   ```

   On the server, as your admin user, let it in with that one command forced. Put
   the whole line of `deploy-job-staging.pub` in place of `<public key>`:

   ```bash
   printf 'restrict,command="/home/heynaija/ssh-deploy.sh" %s\n' '<public key>' | sudo -u heynaija tee -a /home/heynaija/.ssh/authorized_keys >/dev/null && sudo -u heynaija chmod 600 /home/heynaija/.ssh/authorized_keys
   ```

   (The script is put in place in step 5, once the code is on the server.) If the
   server's SSH settings list who may log in, add `heynaija` to that list. This prints
   nothing when there is no such list:

   ```bash
   sudo grep -rE '^\s*(AllowUsers|AllowGroups)' /etc/ssh/
   ```

   Give GitHub's `staging` environment the key and the server's address, with the
   GitHub CLI from this repository's folder. The address is the server's own IP,
   not `staging.heynaija.ng`, which Cloudflare answers for web traffic only. It is a
   secret so it stays out of the workflow logs, which anyone can read.

   ```bash
   gh secret set DEPLOY_SSH_KEY --env staging < deploy-job-staging
   ```

   ```bash
   gh secret set DEPLOY_HOST --env staging --body '<server-ip>'
   ```

   ```bash
   ssh-keyscan -t ed25519 <server-ip> | gh secret set DEPLOY_KNOWN_HOSTS --env staging
   ```

   Check that last one is the server's own key: these two print the same
   fingerprint, the first on your computer and the second on the server.

   ```bash
   ssh-keyscan -t ed25519 <server-ip> | ssh-keygen -lf -
   ```

   ```bash
   ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub
   ```

   If SSH is not on port 22, give `ssh-keyscan` `-p <port>` too, and
   `gh secret set DEPLOY_SSH_PORT --env staging --body '<port>'`.

   Then let only the `staging` branch use the environment and its secrets:

   ```bash
   gh api -X PUT repos/HeyNaija/heynaija/environments/staging -F 'deployment_branch_policy[protected_branches]=false' -F 'deployment_branch_policy[custom_branch_policies]=true'
   ```

   ```bash
   gh api repos/HeyNaija/heynaija/environments/staging/deployment-branch-policies -f name=staging -f type=branch
   ```

   To roll back by running the workflow on a tag, allow tags too
   (`-f name='*' -f type=tag`). `ssh-deploy.sh` still deploys only commits on
   `staging`.
5. **Only `staging` goes to `main`.** Make `staging` the default branch, so pull
   requests open against it:

   ```bash
   gh api -X PATCH repos/HeyNaija/heynaija -f default_branch=staging
   ```

   `.github/workflows/main-takes-staging.yml` moves a pull request into `main`
   from any other branch to `staging`, and fails where it cannot. Require its
   check on `main` (15368 is GitHub Actions; admins can still bypass, for a fix
   that cannot wait for staging):

   ```bash
   gh api repos/HeyNaija/heynaija/rulesets --input - <<'EOF'
   {"name": "Main takes staging only", "target": "branch", "enforcement": "active",
    "conditions": {"ref_name": {"include": ["refs/heads/main"], "exclude": []}},
    "bypass_actors": [{"actor_id": 5, "actor_type": "RepositoryRole", "bypass_mode": "always"}],
    "rules": [{"type": "required_status_checks", "parameters": {"strict_required_status_checks_policy": false,
      "required_status_checks": [{"context": "Only staging goes to main", "integration_id": 15368}]}}]}
   EOF
   ```

## 5. First deploy

As `heynaija` (`sudo -iu heynaija`):

```bash
git clone git@github.com:<you>/heynaija.git /srv/heynaija
```

Put the deploy job's script where its key's forced command points, outside the
checkout so that checking out a release never changes it mid-run. Each deploy then
replaces it with the release's copy:

```bash
install -m 700 /srv/heynaija/infra/deploy/ssh-deploy.sh ~/ssh-deploy.sh
```

Check the key can do nothing else. From your computer, in the folder with the key
files, this must print `This key can only run: deploy <full commit hash>`.
`IdentitiesOnly` makes ssh offer only that key: without it, a key of your own
that also logs in as `heynaija` (production's admin key) would answer instead.

```bash
ssh -o IdentitiesOnly=yes -i deploy-job-staging heynaija@<server-ip> whoami
```

If it prints `heynaija`, the key got in without its forced command: its line in
`authorized_keys` lacks `restrict,command=…`. `Permission denied (publickey)`
means the line is missing, or the SSH settings do not let `heynaija` log in.

Then delete both `deploy-job-staging` files: GitHub has the private key and the
server the public one, and a new pair is quick to make.

```bash
cd /srv/heynaija/infra/deploy && ./gen-env.sh
```

Edit `.env`: `IMAGE_PREFIX=ghcr.io/heynaija/heynaija` (**all lower case**: the
registry rejects capitals, and the organization is `HeyNaija`), the R2 settings
(`S3_*`, with your account ID in `S3_ENDPOINT`),
`SMTP_CONNECTION_URI=smtps://resend:<API key>@smtp.resend.com:465/`,
`SMTP_FROM_ADDRESS`, and `BACKUP_AGE_RECIPIENT` (step 6). The rest is already right
for staging, including the push notification keys `gen-env.sh` made (`PUSH_VAPID_*`).
Keep a copy of the whole file in the password manager.

A server set up before push notifications existed has no `PUSH_VAPID_*` lines. Add
them empty and let `gen-env.sh` fill them, then deploy again:

```bash
printf 'PUSH_VAPID_PUBLIC_KEY=\nPUSH_VAPID_PRIVATE_KEY=\n' >> .env && ./gen-env.sh
```

The scripts load `.env` as shell, so a placeholder left in it breaks them with an
error like `ACCOUNT_ID: No such file or directory`. This must print nothing:

```bash
grep -n '^[^#]*<' .env
```

Install the nginx site, as your admin user (it needs root, and `.env` is readable
only by `heynaija`):

```bash
cd /srv/heynaija/infra/deploy && sudo ./install-nginx.sh
```

Then push to `staging` and watch **Actions** in GitHub. When the deploy job is
green, create the communities and the first invite. These run inside the running
`api` container (`exec`, not `run`: images are tagged by commit, never `latest`):

```bash
docker compose exec api node node_modules/@heynaija/db/dist/seed.js
```

```bash
docker compose exec api node dist/cli/create-invite.js --uses 5 --days 14 --note "staging testers"
```

After signing up, make yourself a site moderator:

```bash
docker compose exec api node dist/cli/moderator.js grant <your-handle>
```

If you are one of the founding team, give yourself the Founder badge too
(`revoke` takes it away):

```bash
docker compose exec api node dist/cli/founder.js grant <your-handle>
```

## 6. Backups

On **your own computer**, make the key that can read the backups. Keep the file in
the password manager and offline, never on the server. On a Mac, install `age`
first:

```bash
brew install age
```

```bash
age-keygen -o heynaija-backup.key
```

Delete the file from your computer once it is in the password manager.

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

Backups cover both databases (members, posts, moderation; accounts and
sessions). Media lives only in R2.

Before each backup, `backup.sh` runs `kratos-cleanup.sh`, which deletes Kratos's
copies of the emails it sent once they are older than
`KRATOS_SENT_MAIL_KEEP_DAYS` (7 by default). Kratos would otherwise keep every
sign-in code email, with its address, for good, even after the account is
deleted (docs/adr/0016). It runs from the same cron line; nothing else to set up.
To run it by hand: `bash /srv/heynaija/infra/deploy/kratos-cleanup.sh`.

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
- [ ] Sign up with an invite; the code email arrives (check spam, and Resend's
      logs). Sign out and sign in again with a code.
- [ ] Notification emails: turn on **Email me my notifications** in Settings, have
      another member reply to one of your posts, and the email arrives within
      about ten minutes (Resend's logs show it). Its link turns email off again.
      They need the same `SMTP_*` settings as the sign-in codes; the API reaches
      Kratos's admin API on the private network for the address.
- [ ] Push notifications ([ADR 0011](../adr/0011-push-notifications.md)): on an
      Android phone, in Chrome, press **Turn on push notifications** in Settings and
      allow them. Have another member reply to one of your posts: the notification
      arrives within seconds and tapping it opens the reply; no email follows for it.
      A second like on one post replaces the first like's notification. On an iPhone,
      add HeyNaija to the Home Screen, open it from there and do the same. Signing
      out stops them.
- [ ] If Google sign-in is on ([google-sign-in.md](google-sign-in.md)): sign in
      with Google, and connect Google to an existing account in Settings.
- [ ] A profile photo and a post with images work: the checks in
      [cloudflare-r2.md](cloudflare-r2.md), step 8.
- [ ] A backup exists in `heynaija-backups/staging/`, and a restore rehearsal worked.
- [ ] An uptime check on `https://staging.heynaija.ng/` (UptimeRobot or Better
      Stack, free) emails you when it is down.

## Day to day

| Task                  | How                                                                                                                                          |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Deploy                | Push or merge to `staging`                                                                                                                   |
| Roll back             | **Actions → Deploy staging → Run workflow** on a tag of an earlier `staging` commit, or on the server: `./deploy.sh <commit from releases.log>` |
| Status                | `docker compose ps` in `/srv/heynaija/infra/deploy`                                                                                          |
| Logs                  | `docker compose logs -f --tail 100 api` (or `web`, `kratos`)                                                                                 |
| Invite people         | `docker compose exec api node dist/cli/create-invite.js --uses 5 --days 14`                                                              |
| Change the nginx site | edit `infra/deploy/nginx/heynaija.conf.template`, deploy, then `sudo ./install-nginx.sh`                                                     |
| Gists (LiveKit)       | its own server: [livekit.md](livekit.md); turning Gists on here is its step 5                                                                |

The server keeps the last five releases' images, so a rollback to one of them
needs no registry. For an older one, `deploy.sh` pulls from GitHub's registry,
which needs `docker login ghcr.io` with a token that can read packages. Database
migrations only ever add, so older code keeps working; a migration that removes or
renames something needs its own plan. CI enforces this for every migration after
0027: one that is not additive (a drop, including of a unique index, a rename, a
type change, a removed default, a constraint without `NOT VALID`, `TRUNCATE`, a
backfill, a volatile default, or an index on an existing table) fails
`pnpm migrations:check` unless the line before that statement (or its own line)
carries `-- allow-breaking: <reason>` saying why. The waiver covers that one
statement. `CREATE INDEX CONCURRENTLY` is not an alternative: Drizzle runs all
pending migrations in one transaction and Postgres refuses it there, so an index
on a busy table needs the waiver and a plan. The check refuses it, and anything
else that cannot run in a transaction (`DROP INDEX CONCURRENTLY`, `VACUUM`), with
or without a waiver. The migrate step takes a lock so
overlapping deploys queue, and fails, rather than waiting forever, if a migration
cannot get its table lock within `MIGRATE_LOCK_TIMEOUT_MS` (default 5000, `0`
disables; set it in the server's `.env`). It retries the whole run a few times
first, so one long query at the wrong moment does not fail the deploy.
