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
- **Development-only settings:** Kratos runs with `--dev`, plain http, and its
  hooks call the API via `host.docker.internal`. There is no production Kratos
  configuration, SMTP provider or TLS yet.
- **Password change after recovery** was exercised up to the settings form but
  not submitted. Changing email or handle in settings is untested.
- **Tests** cover invites, posts, threads, likes, bookmarks, search, trending,
  follows, blocks, mutes, profiles, communities, moderation, rate limits, media
  (profile photos and post images) and the session guard (99 cases, real Postgres,
  Kratos stubbed; storage and the job queue faked in memory, image processing real). The Kratos flows and
  web pages were verified by hand.
- **Counts are computed on read** (likes, replies, followers) with subqueries.
  Fine at pilot size; revisit with measurements before growth.
- **Threads show at most 200 direct replies** and have no pagination yet.
- **Communities are public** groupings: anyone can read them and any member can
  join. Private communities are now possible but not built. Moderator roles exist
  in the schema and are displayed, but there is no way to assign one except by
  hand in the database, and no pinned welcome post.
- **Moderation model.** Site moderators see every report and can remove posts and
  suspend or reinstate accounts. Community moderators see only reports about posts
  in their community and can only remove those posts. Every decision is written to
  an append-only log. Roles are assigned with `pnpm mod:grant`, not in the app.
- **A suspended account is blocked by our API, not by Kratos**: the person can
  still sign in, but can do nothing except file one appeal at a time.
- **Reported members are not notified**, and neither is anyone whose post is
  removed. There are no notifications of any kind yet.
- **Not built from the design mockup:** polls, reposts, notifications,
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
- **Post images and deletion.** When an author deletes a post, its image files
  are deleted at once. When a moderator removes a post, its images are hidden
  everywhere in the app but the files stay in the public bucket, so a restore
  brings them back; anyone who saved an image's URL can still open it (and a CDN
  may cache it). Removing the files on moderator removal, and deciding what must
  be preserved as evidence for abuse-material reports, belong with the scanning
  work in roadmap step 4.
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
  identifier and is always shown beside the name. Moderators cannot clear a name
  or bio except by suspending the account; that belongs with roadmap step 4.
  Search matches names anywhere in the name (not just the start), with a plain
  `ilike` scan that is fine at pilot size.
- **No scanning of uploads for known abuse material**, and a moderator cannot yet
  remove someone's photo (suspending the account hides it). Both are needed
  before uploads are open beyond the invited pilot.
- **Verified against MinIO only.** Cloudflare R2 has not been tried; the setup
  and the checks to run are in `docs/deployment/cloudflare-r2.md`. MinIO no longer publishes images, so the dev stack uses
  Chainguard's build, pinned by digest.
- **Search** matches whole words in posts (no stemming or typo tolerance), handle
  prefixes, and community names or descriptions.
- **Redis is now required by the API** (`REDIS_URL`) for the job queue. Rate
  limits still live in memory.
