# Load testing: how many requests per second one server handles

This kit measures how many requests per second one HeyNaija server handles before
it gets slow, and shows which part gives out first. Everything is in
[`loadtest/`](../loadtest):

| File | What it does |
| --- | --- |
| [`seed.mjs`](../loadtest/seed.mjs) | Fills a throwaway database with members, posts, follows, likes and notifications in realistic proportions. Run it with up to 1,000,000 members. |
| [`sessions.mjs`](../loadtest/sessions.mjs) | Signs load-test users in with an emailed code, the way a browser does, and saves their session cookies for k6. |
| [`k6/journeys.js`](../loadtest/k6/journeys.js) | Simulates signed-in members using the site: home feed, opening posts, profiles, notifications, likes and new posts. Profiles: `smoke` and `ramp`. |
| [`clean.mjs`](../loadtest/clean.mjs) | Removes everything the seed script and k6 created, including the Kratos identities. Use it on a dev database. |
| [`compose.loadtest.yml`](../loadtest/compose.loadtest.yml) | Overlay on `infra/deploy/compose.yml` that turns a rented server into a throwaway test copy of the stack. |
| [`thread-fixtures.mjs`](../loadtest/thread-fixtures.mjs), [`k6/threads.js`](../loadtest/k6/threads.js) | Optional wide, deep, filtered and deleted thread fixtures, focused reading journeys and hot-parent writes. See [thread benchmarks](loadtest-threads.md). |

**Tested** on a laptop (14 October 2026) against the dev stack: the seed script
with 10,000 members (27 s), cleanup back to the exact row counts from before,
200 sessions minted through Mailpit (21 s), the smoke run against `next dev` on
:3000 (every journey passing, 0% errors), and short ramps against a production
build of the web app. The full-scale run on a rented server below has **not**
been done yet.

## Never point this at staging or production

- **Staging** shares the Contabo server with Koinovera. Loading it would slow
  Koinovera down too, and the results would measure two apps fighting over one
  machine. Staging also sits behind Cloudflare, which would rate-limit or block the
  test and would add its own latency. The numbers would mean nothing.
- **Production** has real members.

The scripts refuse to run on anything else. [`lib/target.mjs`](../loadtest/lib/target.mjs)
accepts a database only if it is one of these two:

- **local**: reached on a loopback address, with at most 500 members that the
  load test did not create (a dev box), or
- **named as throwaway**: its Postgres runs with `cluster_name=heynaija-loadtest`
  (which `compose.loadtest.yml` sets) *and* you name it in
  `LOADTEST_THROWAWAY_DB=<host>/<database>`.

It also refuses any host or database name containing `prod`, `staging` or `live`,
and any run with `NODE_ENV=production`. The Kratos admin API must be on loopback
or on the named host.

## What "requests per second" means here

Each k6 iteration is **one request to the web app**: a server-rendered page, or
a call through its `/api` proxy, as a browser makes. So the rate in the k6 summary
is the rate at the front door. Behind each request there is more work:

- **A page view** (`/`, `/p/:id`, `/u/:handle`, `/notifications`) is one Next.js
  render that makes 3–5 API calls: `/v1/me`, `/v1/communities` and `/v1/trending`
  for the shell, plus the page's own data.
- **Every signed-in API call** reads the member's row in the session guard, and
  asks Kratos `whoami` unless the answer for that cookie is cached (30 s). It
  writes `last_seen_at` at most every 5 minutes.

So 500 page views per second becomes about 2,000 API requests and 2,000
`members` reads per second, but only as many Kratos lookups as there are active
sessions every 30 seconds.

**What target to aim for.** With 1M registered members, assume 10–20% are active
on a given day (100–200k). Each active member makes about 100 requests a day,
which gives 10–20M requests a day, or 120–230 req/s on average. Evening peaks
run at 2–3× the average, so **300–600 req/s at peak** is the realistic target. The
ramp runs to 1,000 req/s to show how much headroom is left above that.

### The request mix

Reads dominate, as on any social site. Weights in `ACTIONS` in `journeys.js`:

| % | Request | Kind |
| --: | --- | --- |
| 25 | `GET /` (home feed page) | page |
| 5 | `GET /?feed=following` | page |
| 15 | `GET /p/:id` (open a post) | page |
| 5 | `GET /u/:handle` | page |
| 7 | `GET /notifications` | page |
| 12 | `GET /api/v1/feed` (scroll, with a cursor 70% of the time) | api-read |
| 8 | `GET /api/v1/feed/following` | api-read |
| 8 | `GET /api/v1/me` | api-read |
| 2 | `GET /api/v1/notifications` | api-read |
| 2 | `GET /api/v1/trending` | api-read |
| 8 | `PUT`/`DELETE /api/v1/posts/:id/like` (80% like, 20% unlike) | api-write |
| 3 | `POST /api/v1/posts` (30% replies) | api-write |

In the real app, likes and new posts are Next.js server actions. Their IDs change
with every build, so k6 can't call them. Instead, k6 sends the same API calls
through the web app's `/api` proxy. The API work is the same, but the server
action's re-render is not counted. The extra page views in the mix roughly make
up for it.

A 429 from the app's own rate limits (10 posts a minute and 120 likes a minute
per member) means the app is working as designed. k6 does not count it as a
failure; it counts it under `rate_limited` instead. If that number is large, mint
more sessions.

### The seeded data

Defaults per member, with `--members=1000000`:

| Table | Per member | At 1M members | How it's spread |
| --- | --: | --: | --- |
| members | — | 1,000,000 | 60% have a display name, 30% a bio |
| community_memberships | 0.4 | ~400k | 30% join one community, 10% a second |
| posts | 3 | 3,000,000 | over the last 90 days. 4 in 5 are top-level, 1 in 5 replies, mostly to recent posts. Authors follow a power law. 25% are in a community, 1% are deleted. |
| follows | 12 | ~12M | everyone follows a few accounts. Who gets followed follows a power law: at 1M members, the top account has about 100k followers. |
| likes | 10 | ~10M | active members like more, and recent posts get most of the likes |
| notifications | ~22 | ~22M | one per like, follow and reply by someone else, as the app writes them. Anything older than 2 days is read. |

Change the proportions with `--posts-per-member`, `--follows-per-member` and
`--likes-per-member`. Popularity goes through a fixed shuffle, so the most-followed
accounts are not the first accounts, which are the ones k6 signs in as.

### Signing in without reading a million emails

Sign-in is passwordless (ADR 0003), so there is no password k6 could type. Here is
how load-test users get sessions:

1. `seed.mjs` creates **Kratos identities** for the first `--kratos` members
   (2,000 by default), in batches through the Kratos admin API. Each member's ID
   is their Kratos identity ID, as with a real signup. The rest of the members
   exist only in the app database. That is all the feed, profile and notification
   queries read.
2. `sessions.mjs` signs those users in **through the web app's `/kratos` proxy
   with an emailed code**, exactly like a browser. It reads the code from
   **Mailpit**: the throwaway stack sends its email there, never to Resend. It
   saves the `hn_session` cookies to `loadtest/.sessions.json` (gitignored).
   Sessions last 14 days, so you do this once per stack.
3. k6 picks a random saved session for each request.

Kratos finds a session by its token, using an index, so `whoami` takes about the
same time whether Kratos holds 2,000 identities or 1M. To give every member a real
identity anyway, pass `--kratos=1000000`. That adds about 10–20 minutes of batch
imports (2,000 took 1.4 s on a laptop).

## Running it locally (functional check)

This needs the dev stack (`pnpm infra:up`), the API (`pnpm dev:api`, or its
build) and the web app on :3000. It writes into your **dev** database, and
`clean` takes everything out again.

```bash
pnpm db:seed
```

```bash
pnpm --filter @heynaija/loadtest seed --members=10000
```

```bash
pnpm --filter @heynaija/loadtest sessions --count=200
```

```bash
pnpm --filter @heynaija/loadtest smoke
```

```bash
pnpm --filter @heynaija/loadtest clean
```

`smoke` sends 2 req/s for 30 s and checks that every journey works (checks above
99%, errors below 1%). It does **not** apply the 300 ms latency target by
default, because `next dev` renders pages one at a time without optimisation:
one page takes about a second, and ten at once took 13 s on a laptop. For real
latency numbers, use a production build:

```bash
pnpm --filter @heynaija/web build
```

```bash
cd apps/web && node_modules/.bin/next start -H 127.0.0.1 -p 3002
```

```bash
k6 run -e PROFILE=smoke -e RATE=10 -e P95_MS=300 -e BASE_URL=http://127.0.0.1:3002 -e ORIGIN=http://127.0.0.1:3000 loadtest/k6/journeys.js
```

`ORIGIN` must match the API's `WEB_PUBLIC_URL`, or the API's CSRF check rejects
writes with a 403. You can also try a short ramp on a laptop:
`-e PROFILE=ramp -e RAMP=5,15,30 -e CLIMB_S=10 -e HOLD_S=20`.

Install k6 with `brew install k6` (or see grafana.com/docs/k6).

## The full-scale run, on a rented throwaway server

Use **two** machines in the same region and on the same private network, so the
network between them is not the bottleneck:

- **The server under test**: the same size as production, **4 vCPU / 8 GB**
  (netcup or Contabo, hourly billing if possible). Delete it afterwards.
- **The load generator**: 2–4 vCPU, running k6. Never run k6 on the server under
  test, because k6 would compete with the app for CPU. At 1,000 req/s the
  responses add up to roughly 300 Mbit/s, so use the private network.

### 1. Set up the server under test

On the server, as in [deployment/production.md](deployment/production.md) up to
the point where the app runs, but without nginx, Cloudflare or a domain:

```bash
git clone https://github.com/<owner>/heynaija.git && cd heynaija/infra/deploy && ./gen-env.sh
```

Then edit `infra/deploy/.env`:

```ini
COMPOSE_PROJECT_NAME=heynaija-loadtest
# The address the load generator uses. Plain http: there is no TLS in this test.
SITE_URL=http://<server private IP>:3100
SMTP_CONNECTION_URI=smtp://mailpit:1025/?disable_starttls=true
SMTP_FROM_ADDRESS=no-reply@loadtest.test
# Media isn't exercised; any values do.
S3_ENDPOINT=http://127.0.0.1:9
S3_ACCESS_KEY_ID=unused
S3_SECRET_ACCESS_KEY=unused
S3_UPLOADS_BUCKET=unused
S3_MEDIA_BUCKET=unused
```

Build and start the stack with the load-test overlay (from the repository root):

```bash
docker compose --env-file infra/deploy/.env -f infra/deploy/compose.yml -f loadtest/compose.loadtest.yml up -d --build --wait
```

Allow port 3100 from the load generator only:

```bash
sudo ufw allow from <load generator private IP> to any port 3100 proto tcp
```

The overlay names the Postgres cluster `heynaija-loadtest`, loads
`pg_stat_statements`, logs statements slower than 250 ms, adds Mailpit, and
publishes Postgres (:5432), the Kratos admin API (:4434) and Mailpit (:8025) on
loopback for the scripts.

### 2. Seed it (on the server)

The scripts need Node 22 on the server and the loadtest package installed:

```bash
corepack enable && pnpm install --filter @heynaija/loadtest
```

Create the launch communities with the API image's seed script:

```bash
docker compose --env-file infra/deploy/.env -f infra/deploy/compose.yml -f loadtest/compose.loadtest.yml run --rm migrate node node_modules/@heynaija/db/dist/seed.js
```

Point the scripts at the throwaway stack. Run these in the shell, not in a file:

```bash
set -a; source infra/deploy/.env; set +a
export LOADTEST_DATABASE_URL="postgres://heynaija:${POSTGRES_PASSWORD}@127.0.0.1:5432/heynaija"
export LOADTEST_THROWAWAY_DB=127.0.0.1/heynaija
export KRATOS_ADMIN_URL=http://127.0.0.1:4434 MAILPIT_URL=http://127.0.0.1:8025 BASE_URL=http://127.0.0.1:3100
```

Then seed 1M members and mint 2,000 sessions:

```bash
cd loadtest && node seed.mjs --members=1000000 --kratos=2000
```

```bash
node sessions.mjs --count=2000 --concurrency=20
```

The seed takes roughly an hour at 1M members: 27 s for 10k on a laptop, and it
grows about linearly. It prints a timing for each slice. Before testing, take a
snapshot of the database volume (or a `pg_dump`), so you can reset it between
runs instead of re-seeding.

### 3. Run the ramp (on the load generator)

Copy `loadtest/k6/` and `loadtest/.sessions.json` to the load generator, keeping
the same layout, then:

```bash
k6 run -e PROFILE=ramp -e BASE_URL=http://<server private IP>:3100 --out json=results/ramp.json k6/journeys.js
```

The ramp climbs for a minute and then holds for three minutes at each of
**50 → 100 → 250 → 500 → 1,000 req/s**, about 20 minutes in total. The targets
are **p95 under 300 ms** and **errors under 1%**, checked overall and separately
for each step. The run stops early only if more than 25% of requests fail, which
means the stack has fallen over. To watch it live, add `K6_WEB_DASHBOARD=true`
(dashboard on :5665) and `K6_WEB_DASHBOARD_EXPORT=results/ramp.html` for a report.

To find the knee more precisely, run again with steps around it, for example
`-e RAMP=300,350,400,450`. To check the stack holds steady at your target, use
`-e RAMP=500 -e HOLD_S=1800`.

## Reading the results

### The k6 summary

The summary lists one verdict per step under THRESHOLDS:

```text
http_req_duration{stage:250}  ✓ 'p(95)<300' p(95)=212ms
http_req_duration{stage:500}  ✗ 'p(95)<300' p(95)=1.9s
http_req_failed{stage:500}    ✗ 'rate<0.01' rate=4.2%
```

**Capacity is the last step that passes both targets** (250 req/s in this
example). `{kind:page}`, `{kind:api-read}` and `{kind:api-write}` show which kind
of request slows down first. For a per-route breakdown, group
`results/ramp.json` by the `name` tag (`GET /p/:id`, `PUT /api/v1/posts/:id/like`, …).
A climbing `dropped_iterations` count or a `vus` count near `maxVUs` also means
the server has stopped keeping up. Latency grows, so k6 needs more and more
virtual users to hold the rate.

### On the server while it runs

Which container is using the CPU and memory? Four cores is 400%:

```bash
docker stats
```

If Postgres sits near 400% while `web` and `api` are low, the database is the
limit. If `api` or `web` sits at about 100%, that Node process is the limit:
each runs on one core.

Which queries take the time? `pg_stat_statements` collects for the whole
cluster, including Kratos's queries in the `kratos` database. To read it, create
the extension once, then reset the counters before each run and read them after:

```bash
docker exec heynaija-loadtest-postgres-1 psql -U heynaija -c "create extension if not exists pg_stat_statements"
```

```bash
docker exec heynaija-loadtest-postgres-1 psql -U heynaija -c "select pg_stat_statements_reset()"
```

```bash
docker exec heynaija-loadtest-postgres-1 psql -U heynaija -c "select d.datname, s.calls, round(s.total_exec_time) as total_ms, round(s.mean_exec_time::numeric, 1) as mean_ms, left(regexp_replace(s.query, '\s+', ' ', 'g'), 120) as query from pg_stat_statements s join pg_database d on d.oid = s.dbid order by s.total_exec_time desc limit 15"
```

The query at the top of `total_ms` is the one to fix first.

Are connections waiting?

```bash
docker exec heynaija-loadtest-postgres-1 psql -U heynaija -c "select datname, state, wait_event_type, count(*) from pg_stat_activity group by 1,2,3 order by 4 desc"
```

Slow statements (over 250 ms), Kratos and the API:

```bash
docker logs --since 10m heynaija-loadtest-postgres-1 2>&1 | grep duration
```

```bash
docker logs --since 10m heynaija-loadtest-kratos-1 2>&1 | grep -iE "error|warn" | tail -50
```

```bash
docker logs --since 10m heynaija-loadtest-api-1 2>&1 | grep -iE "error|warn|timeout|503" | tail -50
```

A `503 identity service unreachable` or `identity service error` from the API
means its `whoami` call to Kratos timed out (after 5 s) or failed.

Test one change at a time. Fix the top item, restore the database snapshot, and
run the ramp again.

## The likely first bottlenecks

These are in the order to check them. The first one is measured: on the
10,000-member seed, a laptop's Postgres hit 390% CPU at 20–30 req/s, while
Next.js and the API each stayed near 10%.

1. **The trending sidebar on every page.** `PostsService.trending` scores *every*
   top-level post from the last 7 days with two `count(*)` subqueries each, then
   sorts them, and the shell calls it on every page render. With 10k members
   (1,885 posts in the window) it took 160 ms of Postgres time per call. At 1M
   members there are about 190k posts in the window, so expect seconds per call.
   Fix: cache the result for a minute (it is the same for everyone apart from
   blocks and mutes, which can be filtered after), or keep like and reply counts
   on the post row.
2. **Like and reply counts computed per post on every read.** Every post shown
   (30 per feed page) runs `count(*)` over its likes and replies, joined to
   `members` to drop inactive accounts. A popular post with 100k likes costs 100k
   rows every time someone scrolls past it. Fix: counter columns updated on
   like, unlike and reply, or a periodically refreshed count.
   **Done** (migration `0011_post_counters`): `posts.like_count` and
   `posts.reply_count`, kept by triggers. On the 10k seed, a 10→30 req/s ramp
   went from about 33 s to 27 s of Postgres CPU in the app database. The 30
   most-liked posts now read in 0.08 ms instead of 63 ms, and the trending
   ranking takes 2 ms instead of 24 ms.
3. **Kratos `whoami` and a `members` UPDATE on every API call.** *Done
   (14 October 2026).* The session guard used to ask Kratos about the cookie on
   every request (Kratos queries its own tables in the same Postgres) and then
   write `last_seen_at`: 3–5 Kratos round trips and 3–5 row writes per page view.
   Now `KratosService` reuses a valid `whoami` answer for `WHOAMI_CACHE_TTL_S`
   (30 s) in Redis, keyed by a SHA-256 of the cookie, and the guard writes
   `last_seen_at` at most every 5 minutes. `members.active` is still read on
   every request, so suspensions apply at once, and the web app's `/logout`
   drops the cached entry before Kratos ends the session. Still to do: have
   Next.js fetch the shell's `/v1/me` once per render (it already uses React
   `cache`).
4. **Postgres connections and settings.** *Done (14 October 2026).* The API's
   `pg.Pool` now keeps **20 connections** (`DATABASE_POOL_MAX`; pg's default was
   10), and `infra/deploy/compose.yml` runs Postgres with `shared_buffers=2GB`,
   `effective_cache_size=5GB`, `work_mem=16MB` and `maintenance_work_mem=256MB`
   for the 8 GB production server. Staging sets smaller values in its `.env`
   ([deployment/staging.md](deployment/staging.md)). Check the
   `pg_stat_activity` query above to see whether 20 is still the right number.

   **Measured on a laptop** (10k-member seed, production web build, 200
   sessions, `-e PROFILE=ramp -e RAMP=20,40,60 -e CLIMB_S=10 -e HOLD_S=30`):

   | | Before | After |
   | --- | --: | --: |
   | Kratos `whoami` calls | 14,070 | 1,714 (−88%) |
   | p95, all requests | 66 ms | 52 ms |
   | p95 at 60 req/s | 72 ms | 48 ms |
   | errors | 0% | 0% |

   With a harder ramp (`RAMP=60,90,120`, 60 s climbs) both versions fail from
   90 req/s: pages time out at about the same rate, while API calls are faster
   after (p95 2.75 s before, 1.85 s after). Past that point the limit is the page
   renders (items 1 and 6), not the session guard.
5. **Indexes for the feed queries.** The Following feed filters on
   `author_id in (followed)` or `community_id in (joined)` and sorts by
   `created_at`. For a member who follows many busy accounts, Postgres may walk
   `posts_created_idx` backwards through a lot of rows. Check the plan with
   `explain (analyze, buffers)` for a heavy follower. `notifications` has no index
   on `actor_id` or `post_id`, so deleting a post or member scans the whole table
   (`clean.mjs` shows this). *Fixed:* migration `0010` adds
   `notifications_actor_idx` and `notifications_post_idx`.

   **Following with reposts: done (17 October 2026).** With reposts (ADR 0007)
   the Following query asked for "the viewer, or anyone in (their follows)". Postgres
   estimated that the same for every viewer, so it read every repost on the site on
   every Following page, and for someone following a dozen quiet accounts it still
   walked `posts_created_idx` through most of the posts. `PostsService.entries`
   now reads the visible members and joined communities first and passes them as
   arrays, so the plan fits the viewer, and migration `0016` adds
   `reposts_created_idx` (newest reposts site-wide) and
   `reposts_post_created_idx` (a post's reposts in time order, replacing
   `reposts_post_idx`). Pages are identical before and after: 3,029 pages for 504
   viewers and 230 profiles, with mutes, blocks and suspended members, compared
   entry by entry.

   **Measured** on a 200k-member seed with 1.5M reposts, against Postgres limited
   to 4 vCPU / 8 GB with the production settings, calling `PostsService` directly
   (page 1, 30 posts, p50; the heavy viewers follow the 200, 1,000 or 5,000
   most-followed accounts, or the 1,000 members who repost most):

   | Following | Before | After |
   | --- | --: | --: |
   | follows 10–15 accounts | 128 ms | 16 ms |
   | the same, page 5 | 299 ms | 14 ms |
   | follows 200 / 1,000 / 5,000 popular accounts | 151 / 138 / 270 ms | 29 / 42 / 100 ms |
   | follows the 1,000 busiest reposters | 153 ms | 40 ms |
   | pages per second, 20 at once, light / 1,000-follow viewers | 18 / 15 | 214 / 106 |

   The profile Posts tab is unchanged at about 10 ms. Through the web app (20k
   members, 30k reposts, production build) a Following-heavy k6 mix at 30 req/s
   took Postgres from 122% to 69% CPU. Before reposts existed, the 1,000-follow
   viewer took 7 ms: most of what is left for very large follow lists is planning
   the arrays (about 1 ms per 1,000 members each time one appears).
6. **Next.js SSR CPU.** One `next start` process renders on one core. When the
   database is no longer the limit, expect `web` to sit at about 100% in
   `docker stats`. Fixes: run two or more web replicas (or Node cluster) behind
   nginx, cache the parts of pages that are the same for everyone, and keep the
   number of API calls per render down.
7. **One API process.** The same applies to NestJS. Also, the in-memory rate
   limiter (`rate-limit.ts`) must move to Redis before running more than one API
   process.

## Cleaning up

- **Rented servers:** delete both. Nothing from them is ever reused.
- **Dev database:** `pnpm --filter @heynaija/loadtest clean`. It deletes the
  Kratos identities, then every row that belongs to a load-test member or post,
  including anything you did to them while browsing, and removes `.sessions.json`.
  On 10k members it takes about two minutes, mostly in foreign-key checks on
  `notifications`.
