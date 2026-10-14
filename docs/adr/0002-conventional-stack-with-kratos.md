# ADR 0002 — Drop the AT Protocol; conventional stack with Ory Kratos

**Date:** 13 October 2026 · **Status:** Accepted · **Supersedes:** ADR 0001 and the
architecture sections of PLAN.md (§0, §2, §3, §5, §6 PDS parts, §8 Phase 0)

## Decision

heynaija is a conventional web application: Next.js, a NestJS API and PostgreSQL
as the source of truth for posts. Identity (accounts, passwords, sessions, email
verification, recovery) is delegated to a self-hosted Ory Kratos.

The self-hosted PDS, the PLC directory, the firehose indexer and AT OAuth are
removed.

## Why

The Phase 0 spike worked, but showed what the protocol costs a 200-person pilot:

- nothing can be private (no private communities, no DMs);
- we operate a PDS and hold identity keys we must never lose;
- sign-in happens on the PDS's page, which we cannot shape (and which labels our
  data "Bluesky");
- an indexer, eventual consistency and OAuth exist only because of the protocol.

In exchange it gives account portability, which members benefit from only if the
network succeeds and they later want to leave. The product hypothesis (PLAN.md §1)
does not depend on it.

Kratos rather than hand-written auth: password hashing, breach checks, session
handling, verification and recovery are security-critical and already solved.

## What this gives up

- Protocol-level portability and interoperability with other AT apps. A "download
  my data" export and the open-source codebase are the remaining ways to honour
  the community-ownership promise; neither is built yet.
- Moving to the AT Protocol later is possible but would be a migration project.

## How it works

- **One origin.** The browser only talks to the web app, which proxies the API
  under `/api/v1` and Kratos under `/kratos`. Cookies are first-party; no CORS.
- **Account pages** (`/login`, `/signup`, `/verification`, `/recovery`,
  `/settings`) render Kratos's self-service flows as plain HTML forms that post
  straight to Kratos. They work without JavaScript.
- **Sessions.** The API forwards the `hn_session` cookie to Kratos
  (`/sessions/whoami`) on every authenticated request. Nothing about sessions is
  stored or cached on our side.
- **Members.** `members.id` is the Kratos identity ID. The row is created the
  first time the API sees an identity that has redeemed an invite.
- **Invite-only signup.** `/join` checks the code and stores it in a short-lived
  HttpOnly cookie. Kratos passes that cookie to two API webhooks: one before the
  account is saved (is the code usable? abort with a message if not) and one
  after (spend it for this identity). The API refuses any identity without a
  redemption, so the invite rule is enforced by us, not by trust in the flow.
- **Posts** are rows in Postgres, soft-deleted. The feed excludes deleted posts
  and posts by inactive members.

## Known limitations

- **Losing the race for an invite's last use** leaves a Kratos account that the
  API refuses. It needs a new invite; there is no in-app way to attach one yet.
- **Handles can be changed** in settings. `members.handle` is a copy refreshed on
  the member's next request, so it can lag briefly.
- **Rate limits are in memory.** Posting, likes/follows/joins, reports, search and
  invite checks are limited per member (see `apps/api/src/rate-limit.ts`). The
  counters reset when the API restarts and are not shared between instances, so
  they must move to Redis before the API is scaled out. Signed-out callers share
  one budget because the API cannot see their IP behind the web app's proxy.
  Sign-in attempts are not limited by us; that is left to Kratos's defaults.
- **Kratos logs webhook request headers, including the shared secret, at `info`
  level.** Production must run at `warning` or otherwise keep those logs private.
- **Deployment** (`infra/deploy/`, guides in `docs/deployment/`): Docker Compose
  behind the host's nginx and Cloudflare; staging shares a server with Koinovera
  staging, production has its own. GitHub Actions builds the images and a
  self-hosted runner per server deploys them. nginx rather than Caddy because the
  staging server's nginx already owns ports 80 and 443, and Caddy's main advantage
  (obtaining certificates) does not apply behind Cloudflare's origin certificate. Kratos runs without `--dev`, over
  https, at log level `warning`, with its webhooks on the private Docker network and
  email through Resend; its configuration lives in `infra/deploy/compose.yml` so the
  site address and secrets can be filled in. The dev configuration still runs
  Kratos with `--dev` over plain http. Tested end to end on a laptop, not yet on a
  real server, Cloudflare, R2 or Resend.
- **The web app's proxy targets are fixed when it is built** (Next.js reads
  rewrites at build time), so the Docker image always points at `api:4000` and
  `kratos:4433`. In a deployment `/media` is served by nginx, not the web app.
- **Password change after recovery** was exercised up to the settings form but
  not submitted. Changing email or handle in settings is untested.
- **Tests** cover invites, posts, threads, likes, bookmarks, search, trending,
  follows, blocks, mutes, profiles, communities, moderation, rate limits, media
  (profile photos and post images) and the session guard, notifications and safety actions (116 cases, real Postgres,
  Kratos stubbed; storage and the job queue faked in memory, image processing real). The Kratos flows and
  web pages were verified by hand.
- **Counts are computed on read** (likes, replies, followers) with subqueries.
  Fine at pilot size; revisit with measurements before growth.
- **Threads show at most 200 direct replies** and have no pagination yet.
- **Communities are public** groupings: anyone can read them and any member can
  join. Private communities are now possible but not built. There is no pinned
  welcome post.
- **Moderation model.** Site moderators see every report and can remove posts,
  remove a profile photo, clear a name and bio, suspend or reinstate accounts,
  and make members community moderators (in the app, on the moderation page).
  Community moderators see only reports about posts in their community and can
  only remove those posts. Every decision, including role changes, is written to
  an append-only log, and the member affected is notified. **Site-wide** roles are
  still assigned only with `pnpm mod:grant`, by whoever runs the service, so a
  compromised moderator account cannot create more site moderators.
- **A suspended account is blocked by our API, not by Kratos**: the person can
  still sign in, but can do nothing except file one appeal at a time.
- **Notifications are in-app only**: a Notifications page and an unread count in
  the navigation. No email, push or live updates; the count refreshes on the next
  page load. They are written in the same transaction as the reply, like, follow
  or moderation decision. A like or follow notifies once, however often it is
  undone and redone, and stops showing if it is undone. Notifications from
  someone the member blocked or muted, or who is suspended, and about deleted
  posts, are hidden when read rather than deleted. Moderation notices carry no
  moderator name and never the moderator's private note. Reported members are
  not told they were reported. A suspended member cannot read notifications, so
  their account page shows whether their appeal is waiting or was turned down.
  Nothing deletes old notifications yet; at pilot scale that is fine. Opening the
  Notifications page marks everything up to the newest shown as read.
- **Not built from the design mockup:** polls, reposts,
  community votes. Members without a photo get a tinted initial.
- **Themes** are light, dark and system. The choice is stored in the browser
  (`localStorage`), not on the account, so it does not follow a member to another
  device. A small inline script applies it before first paint.
- **Media: profile photos and post images.** Both use signed direct upload to a
  private bucket, a server-side check and re-encode to WebP, and a public bucket
  with immutable URLs. Profile photos are processed inside the request. Post images
  (up to four, longest edge 640 and 1600px, proportions kept) are processed by a
  BullMQ job on Redis; the composer polls until each is ready, and a post can only
  use ready images. The worker runs inside the API process, two jobs at a time;
  it can move to its own process without code changes to the producer.
- **Images taken down are quarantined, not deleted.** When a moderator removes a
  post or a profile photo, its files move from the public bucket to a private
  `quarantine/` prefix in the uploads bucket: off the internet, but kept as
  evidence and so a restore can bring them back. If the move fails, the decision
  still stands and the hourly sweep finishes it. When an author deletes their own
  post its images are deleted, unless the post has an open report, in which case
  they are quarantined too. Nothing yet purges Cloudflare's cache, so a copy
  cached before removal can still be served; that, and how long quarantine is
  kept, are open items in `docs/safety/abuse-material-scanning.md`.
- **Abandoned images** (uploads never finished, and post images never posted) are
  cleared an hour later: for one member whenever they start an upload, and for
  everyone by an hourly job. A composer left open over an hour loses its images
  and says so when posting.
- **Alt text is optional** (up to 1,000 characters). The composer asks for it but
  does not require it, and there is no "ALT" badge. Tapping an image opens a
  full-screen viewer (a native modal dialog: arrows, swipe, Escape) that shows
  the description as a caption; without JavaScript the link opens the large
  image itself. There is no zoom beyond the browser's own pinch-zoom.
- **Display names and bios live in our database**, not in Kratos: they are profile
  content, not identity. Names are up to 50 characters and bios 160, counted as a
  person counts them. Invisible characters and text-direction overrides are
  stripped so a name cannot pose as different text, but nothing stops a member
  choosing someone else's name or "HeyNaija Team"; the handle stays the unique
  identifier and is always shown beside the name. Site moderators can clear a
  name and bio from an account report.
  Search matches names anywhere in the name (not just the start), with a plain
  `ilike` scan that is fine at pilot size.
- **No scanning of uploads for known abuse material yet.** Every upload passes a
  `ContentScanner` before it is published, and a match is blocked and preserved,
  but the scanner in use (`NoScanner`) passes everything. The plan (PhotoDNA in
  the pipeline, Cloudflare's tool at the edge, a runbook and legal questions) is
  in `docs/safety/abuse-material-scanning.md`, and must be carried out before
  uploads open beyond the invited pilot.
- **Verified against MinIO only.** Cloudflare R2 has not been tried; the setup
  and the checks to run are in `docs/deployment/cloudflare-r2.md`. MinIO no longer publishes images, so the dev stack uses
  Chainguard's build, pinned by digest.
- **Search** matches whole words in posts (no stemming or typo tolerance), handle
  prefixes, and community names or descriptions.
- **Redis is now required by the API** (`REDIS_URL`) for the job queue. Rate
  limits still live in memory.
