# HeyNaija

A Nigeria-first, community-owned social network. [PLAN.md](PLAN.md) has the product
plan, what is built, and what comes next; [ADR 0002](docs/adr/0002-conventional-stack-with-kratos.md)
explains the architecture and lists every known limitation.

**Status:** early local build, nothing deployed yet; everything needed to deploy
staging and production is in `infra/deploy/` and `.github/workflows/`, with
step-by-step guides in [docs/deployment/](docs/deployment/staging.md). What works:

- **Accounts:** join with an invite code, sign up, confirm email, sign in and out,
  recover an account (all handled by Ory Kratos).
- **Posting:** posts and threaded replies with up to four images each (with
  descriptions for screen readers, and a full-screen viewer), likes, private bookmarks.
- **People:** profiles with a photo, display name and bio; follow, mute and block.
- **Notifications:** replies, likes, follows and moderation outcomes, with an
  unread count in the navigation.
- **Communities:** five launch communities to join and post in.
- **Feeds:** Latest, Following (people and communities, each post says why it is
  there), per-community, trending, and search over members, communities and posts.
- **Safety:** report a post or account, a moderation queue (remove post, suspend
  account, dismiss), appeals from suspended members, a decision log, rate limits.
- **Look:** light, dark and system themes; works down to phone width.
- **Governance preview:** a public information page for upcoming community votes,
  treasury transparency and decision history, with a Public Treasury spotlight.
  Voting and treasury transactions are not live.

## How it fits together

```text
Browser ──> Next.js web app (127.0.0.1:3000)
              ├── /api/v1/*  ──> NestJS API ──> Postgres (members, posts, invites)
              │                      └──> Redis (BullMQ: image processing jobs)
              ├── /media/*   ──> object storage (public bucket of processed images)
              └── /kratos/*  ──> Ory Kratos ──> Postgres (identities, sessions)
                                     │  └──> Mailpit (dev email inbox)
                                     └── webhooks ──> API (invite check on signup)
```

- **Ory Kratos** owns accounts: email, handle, password, sessions, email
  verification and recovery. We write none of that ourselves.
- **The API** owns everything else. It asks Kratos who a session cookie belongs
  to on every request, and only accepts identities that joined with an invite.
- **The web app** is the only thing the browser talks to; it proxies the other two.

| Path | What |
|---|---|
| `apps/web` | Next.js web app: feeds, threads, profiles, communities, moderation, and the account pages rendered from Kratos flows |
| `apps/api` | NestJS + Fastify API: session guard, invites, posts, communities, feeds, search, moderation, rate limits |
| `packages/db` | Drizzle schema, migrations and community seed data for the app database |
| `infra/kratos` | Kratos configuration and identity schema |
| `infra/compose` | Local stack: Postgres, Redis, Kratos, Mailpit, MinIO |

## Run it locally

Needs Node 22+, pnpm 10 and Docker.

```bash
pnpm install
pnpm infra:env          # writes or tops up .env with random local secrets
pnpm infra:up           # Postgres :5433, Redis :6380, Kratos :4533/:4534, Mailpit :8026, MinIO :9100/:9101
pnpm build
pnpm db:migrate
pnpm db:seed            # creates the five launch communities (safe to re-run)
pnpm media:init         # creates the two storage buckets on the local MinIO
```

Then, in two terminals:

```bash
pnpm dev:api
```

```bash
pnpm dev:web
```

Create an invite and open the link it gives you a code for:

```bash
pnpm invite:create --uses 5 --days 14 --note "first testers"
```

Go to `http://127.0.0.1:3000/join?code=<the code>` (use `127.0.0.1`, not
`localhost`: Kratos issues its cookies for that host). Emails that Kratos sends
(verification and recovery codes) land in Mailpit at <http://127.0.0.1:8026>.

`dev:api` recompiles and restarts itself when API code changes.

## Media

Profile photos and post images. The browser shrinks the image, uploads it straight
to a private bucket using a short-lived signed URL, and the API then checks it is a
real image, re-encodes it at two sizes (which removes any location data), and
publishes those to a public bucket. Profile photos are processed during the
request; post images by a background job (BullMQ on Redis, running inside the API
process), while the composer shows "Processing…" until they are ready. An hourly
job clears uploads that were never finished or never posted.

Storage is any S3-compatible service, set by the `S3_*` variables: MinIO locally
(console at <http://127.0.0.1:9101>), Cloudflare R2 in production. For R2, follow
[docs/deployment/cloudflare-r2.md](docs/deployment/cloudflare-r2.md).

## Moderators

Site-wide moderators are assigned only from the command line, by whoever runs the
service. The member must have signed in at least once.

```bash
pnpm mod:grant ada                      # site-wide: every report, can suspend accounts
```

Site moderators can then make members **community** moderators from the
Moderation page in the app (logged, and the member is notified). The command line
works for that too:

```bash
pnpm mod:grant ada --community lagos    # only reports about posts in that community
```

`pnpm mod:revoke` takes the same arguments. Moderators get a Moderation link in the
app.

Images that moderators take down are kept privately, not deleted. Before uploads
open beyond invited testers, follow
[docs/safety/abuse-material-scanning.md](docs/safety/abuse-material-scanning.md).

`pnpm infra:down` stops the stack. Local state lives in `infra/compose/.data/`.

## Design

Tokens, primitives and the layout live in `apps/web/app/globals.css`; the rules
(palette, radius by role, rows rather than cards, no gradients) are in
[PLAN.md §6](PLAN.md#6-design-system). Icons come only from `apps/web/app/ui/icons.tsx`.

If the dev site suddenly looks unstyled after a CSS change, restart `pnpm dev:web`;
the dev server has served a stale stylesheet more than once. If that is not enough,
stop it, delete `apps/web/.next`, and start it again.

## Checks

```bash
pnpm typecheck
```

```bash
pnpm test        # API tests, against a scratch Postgres database (needs `pnpm infra:up`)
```

CI (`.github/workflows/ci.yml`) runs build, typecheck, tests and a dependency audit.
