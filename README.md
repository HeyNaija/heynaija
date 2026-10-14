# heynaija

A Nigeria-first, community-owned social network. See [PLAN.md](PLAN.md) for the
product plan; note that its AT Protocol architecture has been replaced (see
[ADR 0002](docs/adr/0002-conventional-stack-with-kratos.md)).

**Status:** early local build, nothing deployed yet. What works:

- **Accounts:** join with an invite code, sign up, confirm email, sign in and out,
  recover an account (all handled by Ory Kratos).
- **Posting:** posts, threaded replies, likes, private bookmarks.
- **People:** profiles with a photo, follow, mute and block.
- **Communities:** five launch communities to join and post in.
- **Feeds:** Latest, Following (people and communities, each post says why it is
  there), per-community, trending, and search over members, communities and posts.
- **Safety:** report a post or account, a moderation queue (remove post, suspend
  account, dismiss), appeals from suspended members, a decision log, rate limits.

## How it fits together

```text
Browser ──> Next.js web app (127.0.0.1:3000)
              ├── /api/v1/*  ──> NestJS API ──> Postgres (members, posts, invites)
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

Profile photos are the only uploads so far. The browser shrinks the image, uploads
it straight to a private bucket using a short-lived signed URL, and the API then
checks it is a real image, re-encodes it at two sizes (which removes any location
data), and publishes those to a public bucket.

Storage is any S3-compatible service, set by the `S3_*` variables: MinIO locally,
Cloudflare R2 in production. For R2:

- create two buckets, one private (uploads) and one with public access (media);
- set `S3_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com` and `S3_REGION=auto`;
- add a CORS rule on the uploads bucket allowing `PUT` with a `Content-Type` header
  from the site's origin, since browsers upload to it directly;
- serve the media bucket at `/media` on the site's own domain (a Cloudflare route,
  or `MEDIA_INTERNAL_URL` for the web app's built-in proxy).

## Moderators

There is no screen for assigning moderators; it is done from the command line. The
member must have signed in at least once.

```bash
pnpm mod:grant ada                      # site-wide: every report, can suspend accounts
```

```bash
pnpm mod:grant ada --community lagos    # only reports about posts in that community
```

`pnpm mod:revoke` takes the same arguments. Moderators get a Moderation link in the
app.

`pnpm infra:down` stops the stack. Local state lives in `infra/compose/.data/`.

## Checks

```bash
pnpm typecheck
```

```bash
pnpm test        # API tests, against a scratch Postgres database (needs `pnpm infra:up`)
```

CI (`.github/workflows/ci.yml`) runs build, typecheck, tests and a dependency audit.
