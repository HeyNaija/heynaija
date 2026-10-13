# heynaija

A Nigeria-first, community-owned social network. See [PLAN.md](PLAN.md) for the
product plan; note that its AT Protocol architecture has been replaced (see
[ADR 0002](docs/adr/0002-conventional-stack-with-kratos.md)).

**Status:** early local build. You can join with an invite code, create an
account, confirm your email, sign in and out, recover your account, post, read a
chronological feed and delete your own posts. Nothing is deployed yet.

## How it fits together

```text
Browser ──> Next.js web app (127.0.0.1:3000)
              ├── /api/v1/*  ──> NestJS API ──> Postgres (members, posts, invites)
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
| `apps/web` | Next.js web app: feed, composer, and the account pages rendered from Kratos flows |
| `apps/api` | NestJS + Fastify API: session guard, invites, posts, feed |
| `packages/db` | Drizzle schema and migrations for the app database |
| `infra/kratos` | Kratos configuration and identity schema |
| `infra/compose` | Local stack: Postgres, Redis, Kratos, Mailpit |

## Run it locally

Needs Node 22+, pnpm 10 and Docker.

```bash
pnpm install
pnpm infra:env          # writes or tops up .env with random local secrets
pnpm infra:up           # Postgres :5433, Redis :6380, Kratos :4533/:4534, Mailpit :8026
pnpm build
pnpm db:migrate
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

`dev:api` builds once and runs; restart it after changing API code.

`pnpm infra:down` stops the stack. Local state lives in `infra/compose/.data/`.

## Checks

```bash
pnpm typecheck
```

```bash
pnpm test        # API tests, against a scratch Postgres database
```

CI (`.github/workflows/ci.yml`) runs build, typecheck, tests and a dependency audit.
