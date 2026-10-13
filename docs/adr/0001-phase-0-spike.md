# ADR 0001 — Phase 0 spike: findings and decisions

**Date:** 13 October 2026 · **Status:** Superseded by [ADR 0002](0002-conventional-stack-with-kratos.md) the same day. Kept as a record of what the AT Protocol spike found; the code it describes has been removed.

## What was proven (local, single machine)

Against the official PDS image `ghcr.io/bluesky-social/pds:0.4.5037`:

| PLAN.md §8 step | Result |
|---|---|
| 1. Disposable PDS from the official distribution | Done locally (Docker Compose). No staging host yet. |
| 2. Invite-only account, handle/DID resolution | Done. Signup without a code is rejected; DID resolves via the PDS and the PLC directory. |
| 3. OAuth login in a NestJS proof of concept | Done. PAR + PKCE + DPoP via `@atproto/oauth-client-node`; HttpOnly session cookie. |
| 4. Write `app.bsky.feed.post`, observe firehose | Done. |
| 5. Index into Postgres, read via NestJS | Done. About 0.8 s from write to visible in `/v1/feed`, one sample, idle laptop — not a benchmark. |
| 6. Delete; stop/start indexer | Done. Posts and a delete made while the indexer was down were applied on restart; a full replay from cursor 0 left the read model byte-identical. |
| 7a. PDS backup/restore | Done locally as a cold snapshot: `pnpm pds:restore-drill` restores into a throwaway PDS and checks repos, records, handle resolution, password sign-in and firehose history against the live one. Litestream (the production path) is not set up. |
| 7b. Federation expectations | **Not done.** Needs a public host and real domain. |

Gate 0's functional path passes. Gate 0 is **not** fully closed until step 7b and a
staging deployment are done; both need a server and domains.

## Decisions

1. **ESM everywhere.** The `@atproto/*` SDKs and NestJS 12 are ESM-only, so every
   package is `"type": "module"` with `NodeNext` resolution.
2. **Drizzle, not Prisma** (PLAN.md §3 left this to the spike). Plain TypeScript
   schema, no generated client to wire through the workspace, and
   `onConflictDoUpdate ... setWhere` expresses the revision-guarded upserts the
   indexer depends on.
3. **Own minimal firehose consumer** on `@atproto/sync`, pointed straight at the
   PDS. Tap was not evaluated; revisit in Phase 2 as planned.
4. **Fail-stop indexer.** `@atproto/sync` reports a failed event to `onError` and
   then advances the cursor past it. The indexer exits instead, so it resumes at
   the last good cursor. Trade-off: a permanently bad event will crash-loop and
   needs an operator; that is preferable to silent loss at pilot scale.
5. **Revision-guarded, idempotent projection.** Every write to `posts_index`
   applies only if the event's repo `rev` is newer than the stored one, so replays
   cannot undo an edit or resurrect a deleted post.
6. **Tokens encrypted at rest.** OAuth state and sessions (tokens, DPoP keys) are
   AES-256-GCM sealed with `SESSION_SECRET`; only a SHA-256 of the browser session
   ID is stored.

7. **Read-your-writes in the API.** After the PDS confirms a write, the API
   projects it into `posts_index` itself, using the same revision-guarded
   functions as the indexer (`@heynaija/db` projection). The author sees their
   post without waiting for the firehose, and the later firehose event is a no-op.
8. **Web app proxies the API under `/api`.** One origin for the browser: a
   first-party session cookie, no CORS. Mutations are server actions that relay
   the session cookie to the API; the API stays the only authority.
9. **Account status is filtered on read, not tombstoned.** `members.active`
   mirrors the PDS account status and the feed excludes inactive authors, so a
   reactivated account gets its posts back.

## Limitations and surprises

- **A local PLC directory is required.** Otherwise dev accounts register real DIDs
  on the public plc.directory. `infra/plc-dev` runs `@did-plc/server@0.0.1`, which
  is old and emits the legacy DID-document format. Fine for dev; do not use it as
  a production directory. Production still depends on plc.directory (PLAN.md §0).
- **SDK SSRF protection blocks plain http.** The identity resolver and OAuth
  client refuse `http:` by default. Both are relaxed only when the target is a
  loopback address.
- **`*.test` handles cannot be verified** (no DNS). In local dev the indexer
  caches the handle claimed in the DID document; with real domains it only caches
  verified handles.
- **Firehose with no cursor starts at "now".** First run therefore starts at 0.
  The PDS only retains a bounded event history, so an indexer that is down longer
  than that window needs a repo-level resync, which is not built.
- **OAuth is loopback-only.** The API refuses to start with a non-loopback public
  URL. A deployed API must be a confidential client (hosted client metadata,
  `private_key_jwt`, JWKS endpoint).
- **Scope is broad.** `atproto transition:generic` grants full repo access.
  Granular permission scopes were not tried; PLAN.md asks for minimal scopes.
- **Pinned toolchain.** TypeScript is held at 5.9 (7.x not validated with Nest
  decorator metadata) and `fastify` at the exact version NestJS ships.

## Not built yet

- Litestream continuous backup, off-site storage, and identity-key custody.
- Staging host, TLS, real domains, email (verification and recovery).
- Signup through the PDS's own OAuth UI (accounts are created by script).
- Cleanup of abandoned `oauth_states` rows and expired `app_sessions`.
- Rate limiting, structured API logging, metrics.
- Tests cover the indexer projection only (12 cases). The API, OAuth flow and web
  app are verified by hand; there are no browser E2E tests, lint or format checks.
- CI workflow exists but has never run (no GitHub remote yet).
- Worker, profiles, likes/reposts/follows/replies, communities, moderation.
