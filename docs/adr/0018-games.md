# ADR 0018 — Games: a pluggable section with Chess on Lichess and free-to-play Keno

**Date:** 3 November 2026 · **Status:** Accepted 3 November 2026. Phase 1 built: the
module, the registry, the `games` schema, the `games` flag and a games homepage with
both games marked coming soon. No game can be played yet ·
**Spec:** [docs/games/GAMES.md](../games/GAMES.md), the standing rules for this work

## Decision

HeyNaija gets a Games section to give members reasons to come back:
leaderboards, monthly seasons and competitions, tied into posts and communities.
The launch games are **Chess**, played on Lichess, and **Keno**, built here and
free to play. The section is **pluggable**: a later game is a folder in the API,
a folder in the web app and an entry in the registry, and nothing else.

All of it sits behind the **`games` feature flag** (docs/feature-flags.md): on in
development and staging, off in production until the team launches it. While the
flag is off for a member, or they are not on its allow-list, every `/v1/games` route
and `/games` answer 404 like an address that does not exist.

## Why

- The pilot's question is whether members come back (PLAN.md §9). Games give a
  reason to return that is social: results become posts, leaderboards can be
  narrowed to the people you follow or a community, and competitions can belong
  to a community.
- Chess has a free, open platform that already does the hard parts: play, legal
  moves, ratings and fair-play checks. Lichess needs no client secret or app
  registration, and its Board API lets a game be played inside another site.
- Keno is simple, quick on a cheap phone and needs no partner, so it can be built
  here. Played for money it is a lottery that needs a licence in Nigeria, and
  payments are a Phase 1 non-goal, so it is free to play and stays that way.

## How it works

### Architecture

- **API:** `apps/api/src/games/`, a `GamesModule` that imports `core/` (registry,
  manifests, and later seasons, scoring, leaderboards, competitions and post
  hooks), `chess/` and `keno/`. Until now the API had one flat `AppModule`; the
  settings, database, sign-in guards, invites and rate limiter it needs now live
  in a global `PlatformModule` (`apps/api/src/platform.module.ts`), so feature
  modules can use them. Nothing else moved.
- **Registry in code.** Each game has a manifest (slug, name, tagline,
  description, cover, status `live`, `beta` or `coming_soon`, ranking by rating
  or points, whether it has competitions, and the providers that give the core its
  stats and standings). `core/registry.ts` lists them. The API is the source of
  truth for a game's status; the web app reads the manifests from
  `GET /v1/games`, without the providers.
- **Web:** `apps/web/app/(main)/games/`, inside the normal shell. Each game's
  client code is loaded only on its own pages, so `/games` stays light.
- **Database:** a separate Postgres schema, `games`, kept apart from the social
  tables as `restricted` is (ADR 0005), though unlike `restricted` it is not a
  privacy boundary. Migration `0035_games_core` creates the schema and the shared
  tables: `game_profiles`, `seasons`, `season_scores`, `competitions`,
  `competition_entries` and `game_events` (append-only, the audit trail and the
  source of game posts). Chess and Keno add their own tables in their phases.
  `game` columns are plain slugs with no constraint, so a new game needs no
  migration; services check slugs against the registry.
- **Standings are precomputed** (a BullMQ job or a refreshed table), never worked
  out with heavy queries when a page loads.
- **Safety:** blocks and mutes apply to leaderboards, challenges and game posts as
  they do to feeds. Suspended members cannot use any Games route (`SessionGuard`)
  and will not appear on leaderboards.

### The switch

Games is the `games` flag in `apps/api/src/flags/registry.ts`, following the
repository's feature flags (docs/feature-flags.md). *Amended 3 November 2026:* phase
1 was first built with `GAMES_ENABLED` and `GAMES_MEMBERS` environment settings,
because that was the only pattern in `main`; on merging `staging`, which has the
flag system, Games moved onto it as GAMES.md asks ("following however the repo
already gates features").

- Defaults follow the flag policy: on in development and staging, off in
  production until launch, when a site moderator turns it on from Moderation,
  Feature flags, with no deploy. The same page can keep it to named members (an
  allow-list), which is how a launch can start small.
- Every Games route is `@UseGuards(SessionGuard, FeatureGuard)` with
  `@Feature('games')`: a member the flag is off for gets a 404.
- `GET /v1/me` returns `features.games` with the other flags. The web app shows
  the Games link only when it is true: last in the sidebar, so that when it appears
  as the page fills in only the compose button below it moves, and in the account
  menu on phones, which have no sidebar. `apps/web/proxy.ts` rewrites `/games/*` to
  the missing page for anyone else, failing closed (`lib/games-gate.ts`).
- Games is for members only: a visitor with no session always gets the missing
  page.

Turning the flag off deletes nothing.

### The Lichess dependency

- Lichess owns chess, ratings and anti-cheat; HeyNaija owns the social layer.
  Lichess is the source of truth for legal moves and results.
- Linking uses OAuth2 with PKCE through the web app's single origin. Only the
  scopes needed are asked for: `challenge:read`, `challenge:write` and
  `board:play` first; team and tournament scopes only when community tournaments
  are built. Unlinking deletes the token.
- Tokens are encrypted at rest and never sent to the browser. The repository
  has no encrypted-column helper yet (ADR 0005 lists encrypted columns as unbuilt),
  so phase 2 adds one, with its key from the environment.
- Lichess rate limits are respected: one request at a time per member, and back
  off on 429.
- The board uses chessground and chessops. They are GPL-3, which can be combined
  with HeyNaija's AGPL-3.0-or-later.
- If Lichess is down or changes its API, members can still play on lichess.org.
  Here, cached ratings and challenges go stale until it is back.

### Keno is free to play only

- **No money anywhere.** Members get free tokens each day. Tokens and points can
  never be bought, transferred or redeemed for anything of value. Any proposal to
  attach prizes needs legal review first.
- Rounds are shared and global, drawn by a BullMQ repeatable job (every 5 minutes
  by default), idempotent and safe across restarts. Draws happen only on the
  server.
- **Provably fair:** before a round, SHA-256(serverSeed) is published; after it,
  the seed is revealed and the numbers are derived from the seed and the round
  id, and a public page lets anyone check a round.
- A daily cap uses the existing Redis rate limiter.

## Data export and account deletion

- The export is `heynaija-export/12`: a `games` section with the member's game
  profiles, season scores and competition entries. Keno tickets and the linked
  Lichess username join it in their phases; tokens never do.
- No member foreign key in `games` cascades (ADR 0016). Erasing an account
  deletes the member's game profiles, season scores, competition entries and game
  events; competitions a moderator created stay, pointing at the tombstone.

## Known limitations

- A game's status is code, so changing it needs a deploy.
- Game slugs are not checked by the database; a typo in code would store rows
  for a game that does not exist.
- Spectator replies are hidden from both players until a game ends as a courtesy,
  not anti-cheat: anyone can watch the game on lichess.org.
- Only site moderators can create competitions for now.
- Signed-out visitors cannot see Games at all; whether `/games` should be public
  once it is launched is decided then.
- On staging every member sees Games (with both games coming soon) unless a
  moderator limits the flag, by the flag policy.

## Rollback

Revert the code. Then, before any real game data exists:
`drop schema games cascade;` and delete the `0035_games_core` entry from
`drizzle.__drizzle_migrations` (and `packages/db/drizzle/meta/_journal.json`).
Put `EXPORT_FORMAT` back only together with the code that reads the tables.
