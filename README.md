# HeyNaija

A Nigeria-first social network being built toward community ownership. [PLAN.md](PLAN.md) has the product
plan, what is built, and what comes next; [ADR 0002](docs/adr/0002-conventional-stack-with-kratos.md)
explains the architecture and lists every known limitation.

The public introductions are `/about` (purpose and direction) and `/progress`
(product development, separate from governance). The canonical feature inventory
is [docs/FEATURE_ROADMAP.md](docs/FEATURE_ROADMAP.md), generated from
`docs/feature-roadmap.json`; [the audit notes](docs/roadmap-audit.md) explain evidence,
availability limits and outstanding confirmations.

**Status:** staging is live at https://staging.heynaija.ng and production is
deployed at https://heynaija.ng. Signup stays invite-only: production is not
publicly launched until the conditions in
[PLAN.md §11](PLAN.md#11-definition-of-done-for-the-first-public-beta) are met.
Everything needed to deploy is in `infra/deploy/` and `.github/workflows/`, with
step-by-step guides in [docs/deployment/](docs/deployment/staging.md). What works:

- **Accounts:** join with an invite code (18 and over during the beta, a
  temporary rule; the API refuses a signup without the age confirmation), sign
  up, confirm email, sign in and out, and regain access with an emailed code
  (handled by Ory Kratos). There is no password-recovery flow; losing access to
  the account email is not covered by a separate recovery process.
- **Posting:** posts and expandable threaded replies with cursor pagination and
  up to four images each (with
  descriptions for screen readers, and a full-screen viewer), likes, private bookmarks.
- **People:** profiles with a photo, display name and bio; follow, mute and block.
- **Notifications:** replies, likes, follows and moderation outcomes, with an
  unread count in the navigation.
- **Communities:** five launch communities, and Building HeyNaija, where the app's builders work in the open.
- **Feeds:** Latest, Following (people and communities, each post says why it is
  there), per-community, trending, and search over members, communities and posts.
- **Safety:** report a post or account, a moderation queue (remove post, suspend
  account, dismiss), appeals from suspended members, a decision log, rate limits.
- **Look:** light, dark and system themes; works down to phone width.
- **Portability:** download your own data from Settings as JSON (format 3,
  including reposts and quote references).
- **Governance information:** `/governance` (founding-stage status, how members
  would govern, the path to community ownership, empty states for votes, the
  treasury and decisions), the draft constitution at `/governance/constitution`,
  and explainers for legal membership, voluntary online voting and optional NIN
  verification. Draft v0.3 proposes Incorporated Trustees, three founding trustees
  on initial three-year terms, and two annual representatives. Activation does not
  trigger founding trustee re-election; all three trustee seats open at term expiry.
  No incorporation or legal community ownership is claimed. The generated
  [CAC review copy](docs/governance/cac-constitution.md), [charter/policy guide](docs/governance/README.md)
  and [legal questions](docs/governance/legal-review.md) require Nigerian counsel
  review before adoption. `pnpm governance:check` checks the public/CAC text. Settings
  shows each member's own status. Identity verification, voting membership,
  binding votes and the treasury are not live, and the API refuses to start with
  them switched on ([ADR 0005](docs/adr/0005-governance-and-identity-groundwork.md),
  [open items](docs/governance/open-items.md)). Age is its own status, separate
  from accounts, identity and voting ([ADR 0006](docs/adr/0006-age-status-model.md));
  what opening to under-18s requires is in [under-18-rollout.md](docs/governance/under-18-rollout.md).

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

- **Ory Kratos** owns accounts: email, handle, sign-in by emailed code or Google,
  and sessions. There are no passwords (ADR 0003). We write none of that ourselves.
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
pnpm db:seed            # creates the communities (safe to re-run)
pnpm media:init         # creates the two storage buckets on the local MinIO
pnpm demo:seed          # optional: 14 demo members, threads, images, likes and follows (re-run to refresh)
```

The demo members can sign in as `<handle>@demo.heynaija.test` with the code
Mailpit catches; `pnpm demo:clean` removes them and everything they did.

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
(sign-up and sign-in codes) and the API's notification emails land in Mailpit at
<http://127.0.0.1:8026>. A notification is emailed a few minutes after it happens
(`EMAIL_DIGEST_DELAY_S`, see `.env.example`; set it to 10 to see one quickly), and only
if the member has email on in Settings: members who joined before email existed start with it
off. If your stack is older than this feature, run `pnpm infra:env` and `pnpm infra:up`
again so the API can reach Mailpit's SMTP port. Google
sign-in is off locally unless you set it up: [google-sign-in.md](docs/deployment/google-sign-in.md).

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

## Founder badge

The people who founded HeyNaija carry a **Founder** badge for good, shown next
to their name on their profile, their posts and replies, quoted posts,
notifications and search results. It links to the idea behind HeyNaija
(`/about#about-origin`) and is not an identity check. Like moderator roles, it
is given only from the command line, to a member who has signed in at least once:

```bash
pnpm founder:grant ada
pnpm founder:revoke ada
```

Images that moderators take down are kept privately, not deleted. Before uploads
open beyond invited testers, follow
[docs/safety/abuse-material-scanning.md](docs/safety/abuse-material-scanning.md).

`pnpm infra:down` stops the stack. Local state lives in `infra/compose/.data/`.

## Design

Tokens, primitives and the layout live in `apps/web/app/globals.css`; the rules
(palette, radius by role, cards on a sage ground, no gradients) are in
[PLAN.md §6](PLAN.md#6-design-system). Icons come only from `apps/web/app/ui/icons.tsx`.

If the dev site suddenly looks unstyled after a CSS change, restart `pnpm dev:web`;
the dev server has served a stale stylesheet more than once. If that is not enough,
stop it, delete `apps/web/.next`, and start it again.

## Checks

```bash
pnpm roadmap:generate   # after editing the registry
pnpm roadmap:check      # fail if the generated Markdown drifts (also in CI)
pnpm roadmap:test       # registry schema, evidence paths and generation integrity
```

```bash
pnpm typecheck
```

```bash
pnpm test        # API tests, against a scratch Postgres database (needs `pnpm infra:up`)
```

```bash
pnpm e2e posting # browser tests for one area, with Playwright against the local stack (docs/e2e.md)
```

CI (`.github/workflows/ci.yml`) runs build, typecheck, tests and a dependency audit,
and the browser end-to-end tests against a production build ([docs/e2e.md](docs/e2e.md)).
