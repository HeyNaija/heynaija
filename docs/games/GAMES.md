# Games module

The standing specification for HeyNaija's Games section. Every person and coding
agent working on games code reads this first: `apps/api/src/games`,
`apps/web/app/(main)/games`, and the `games` database schema. If a change conflicts with
this document, stop and ask rather than working around it. Change this document
in the same pull request as any agreed change to the rules.

Progress and status are not tracked here. They live in `docs/feature-roadmap.json`
(rendered at `/progress`), like every other feature.

Also read before starting: PLAN.md, PRODUCT.md, AGENTS.md, apps/web/DESIGN.md,
the games ADR ([0018](../adr/0018-games.md)), and ADRs 0002, 0005 and 0014.

## Purpose

Games give members reasons to return: leaderboards, seasons and competitions,
tied into the social side of HeyNaija. Launch games are Chess (through Lichess)
and Keno (in-house, free to play). The system is pluggable: a future game means a
new folder on each side plus a registry entry, and nothing else.

Use the repo's terminology: "members", "posts", "communities". Posts made by game
events are ordinary posts in the existing model.

## Structure

```text
apps/api/src/games/
  games.module.ts      GamesModule, imports the submodules below
  AGENTS.md, CLAUDE.md pointers to this document
  core/                registry, manifests, seasons, scoring (Game Score XP),
                       leaderboards, competitions, post hooks
  chess/               Lichess OAuth (PKCE), API client, NDJSON streams,
                       challenges, results
  keno/                draw engine, provably fair RNG, payout table,
                       BullMQ draw job, tickets
apps/web/app/(main)/games/   inside the (main) route group, for the normal shell
  page.tsx             games homepage
  AGENTS.md, CLAUDE.md pointers to this document
  _components/         shared game UI: cards, leaderboard, competition strip
  chess/               routes + _components (board, challenge flow, rating
                       card, live view)
  keno/                routes + _components (number picker, draw board,
                       ticket history, verify page)
```

`GamesModule` is built on the global `PlatformModule`
(`apps/api/src/platform.module.ts`), which provides the settings, database,
sign-in guards and rate limiter to every feature module.

The pointer files: `AGENTS.md` says "Read docs/games/GAMES.md before changing
anything in this folder." `CLAUDE.md` contains `@AGENTS.md`.

Database: game tables live in a separate Postgres schema, `games`, mirroring how
`restricted.*` is kept apart, with Drizzle migrations in `packages/db/drizzle`.
Lichess OAuth tokens are encrypted at rest and never returned to the browser.

The game registry and manifests live in the API (`core/registry.ts`), which is the
source of truth for each game's status (live, beta, coming_soon). The web app reads
them through `/api/v1/games`. Because the registry is code, `game` columns in the
`games` schema are plain slugs with no database constraint: adding a game needs no
migration. Services check slugs against the registry.

Every member-keyed table in `games` is covered by account erasure
(`account-deletion.service.ts`, ADR 0016's inventory) and by the data export; no
member foreign key cascades.

## Shared core

- **Manifest per game:** slug, name, tagline, description, cover image, status,
  rankingType ("rating" or "points"), supportsCompetitions, and providers for
  stats and leaderboards.
- **Tables:** game_profiles (member, game, stats), seasons (monthly),
  season_scores (member, season, game, points, xp), competitions,
  competition_entries, game_events (append-only audit and the source for game
  posts).
- **HeyNaija Game Score:** cross-game XP from participation, wins and competition
  placements. Monthly seasons, with all-time stats kept separately.
- **Leaderboards:** per game and global, per season, with friends (follows) and
  community filters. Standings are precomputed (a BullMQ job or a refreshed
  table), never computed with heavy queries on page load.
- **Explainer:** a public "How games scoring works" page that states every rule,
  in the spirit of /about/discover (`/games/scoring`; behind the `games` flag until
  launch, by the owner's choice).
- **Agreed XP (phase 5):** chess 10 for a game played to the end, +10 a win, +5 a
  draw, 0 aborted; Keno 2 a round played, +1 per 10 points (at most +20 a round);
  competitions 5 for playing, +100 / +60 / +40 for 1st / 2nd / 3rd, +20 for 4th to
  10th. Rules live in `core/scoring.ts` only; change them there and the explainer
  follows.
- **Safety:** blocks and mutes apply to leaderboards, challenges and game posts
  the same way they apply to feeds. Suspended members cannot play or appear on
  leaderboards.

## Games homepage (/games)

- The member's Game Score, current season and rank, with an empty state for new
  members.
- Game cards from the registry: cover, name, tagline, status chip, Play button.
  coming_soon games render as such.
- Season leaderboard preview with a tab per game; upcoming and live
  competitions; recent game posts.
- Only real numbers. No invented player counts, members or results; use
  EmptyState where there is no data.

## Design rules

- Tokens and primitives from `apps/web/app/globals.css` (.btn, .chip, cards,
  EmptyState, Menu). Icons only from `app/ui/icons.tsx`.
- No new colours, no gradients, 12px cards (PLAN.md §6).
- Light, dark and system themes.
- Mobile first, no horizontal overflow at 320px.
- Lazy load each game's client code. Games must stay fast on a low-end Android
  phone on a slow connection.

## Chess (Lichess)

Lichess owns chess, ratings and anti-cheat. HeyNaija owns the social layer.

1. **Linking:** Lichess OAuth2 with PKCE. Lichess needs no client secret or app
   registration; the client ID is the site's host. The callback is
   `/games/chess/callback` on the web app's single origin, which passes it to the
   API. Request only the scopes needed: challenge:read, challenge:write and
   board:play; tournament:write only from a community moderator who asks to run
   tournaments (phase 6). No team scope is needed: team pages are public.
   Tokens are sealed with `GAMES_TOKEN_KEY`. Unlinking revokes and
   deletes the token. Linking lives on /games/chess only.
2. **Profile:** the Lichess username, plus Blitz, Rapid, Classical and
   Correspondence ratings, cached and refreshed on a schedule and on demand.
3. **Challenges:** a member challenges another member who has linked Lichess
   (both with Games, no block either way). Rated or casual. Time controls are a
   fixed list of what the Board API allows (no Bullet; Blitz only for direct
   challenges), in `chess/time-controls.ts`, enforced in the API and offered as
   is in the UI. The challenge is made on Lichess only when accepted, with both
   members' tokens (ADR 0018). The challenged member is notified in the app, by
   email and by push (`chess_challenge`), with an opt-out like the others.
4. **Play inside HeyNaija** through the Board API: stream game state, move, offer
   or accept draws, resign, and reconnect cleanly. Respect Lichess rate limits:
   one request at a time per member, and back off on 429. Use chessground and
   chessops (GPL-3, which can be combined with our AGPL licence). Lichess is the
   source of truth for legality and results.
5. **Spectating:** a live board, plus a discussion thread. Threads live in the
   **Chess Arena** community and are started by **The Arbiter (`@arbiter`)**, an
   automated account with no sign-in, when the challenger ticks "Open a public
   thread". Only The Arbiter starts threads there; members reply. Spectator replies
   are hidden from both players until the game ends. The UI says this is courtesy,
   not anti-cheat, since anyone can watch the game on lichess.org. Live games are
   listed on /games/chess and linked from profiles. The browser long-polls the API
   (no stream to the browser); one watcher per game reads the Board API stream
   (ADR 0018).
6. **Results:** on game end, fetch the result and new ratings from Lichess, write
   a game_event (XP is awarded from these in phase 5), and The Arbiter replies in
   the game's thread with the result.
7. **Community tournaments:** existing HeyNaija communities can link to a Lichess
   team, enabling Arena and Swiss tournaments created through the API.
   **Agreed (phase 6):** a moderator of the community who Lichess lists as a
   leader of the team links it (one team per community, and the reverse) and
   makes its tournaments with their own token. Games are played on lichess.org;
   HeyNaija shows the tournament, the community's members who play (matched by
   their linked account), standings read from Lichess and the result, posted by
   The Arbiter in the community. Places among HeyNaija members follow Lichess's
   order, and give the usual competition XP; tournament games give no XP of
   their own.

## Keno (in-house, free to play only)

- **No money anywhere.** Members receive free daily tokens. Tokens and points can
  never be bought, transferred or redeemed for anything of value. Keno played for
  money is a licensed lottery in Nigeria, and payments are a Phase 1 non-goal.
  Any proposal to attach prizes needs legal review first.
- **Rules:** numbers 1 to 80, 20 drawn per round, members pick 1 to 10 spots,
  points paid from a fixed, configurable table.
- **Shared global draws** on a BullMQ repeatable job (default every 5 minutes,
  configurable), with a countdown. The job is idempotent and safe across API
  restarts.
- **Provably fair:** before each round, publish SHA-256(serverSeed). After the
  draw, reveal serverSeed and derive the numbers deterministically from
  serverSeed and the round id. A public verify page lets anyone check a round.
- Draws happen only on the server.
- **Daily play cap,** enforced with the existing Redis rate limiter, with Postgres
  counting the day's tokens and deciding (ADR 0018, phase 4).
- Optional posts for draw results and notable wins (none yet: the owner chose to
  leave them out of phase 4).
- **Agreed numbers (phase 4):** 20 free tokens a member a day, reset at midnight
  Lagos time, one token a ticket for one draw; a draw every 5 minutes
  (`KENO_DRAW_EVERY_MS`); tickets close 15 seconds before a draw and go into the
  next; points from table `v1` in `keno/payouts.ts`, never edited once used (add a
  version instead); standings for this month and all time.

## Competitions engine

Shared across games: name, game, format, eligibility (open, community, invite),
entry window, schedule, standings source (Lichess tournament results for chess,
points within a draw window for keno), status lifecycle, and results published
as posts. Site moderators create Keno competitions (`keno_points`, phase 5);
community moderators who lead the linked Lichess team create their community's
chess tournaments (`lichess_arena`, `lichess_swiss`, phase 6). Results are posted by The Arbiter in **Game Night**
(`game-night`), or in the competition's own community; only The Arbiter starts
posts in Game Night.

## Feature flag, roadmap and docs

- **Feature flag:** the whole Games module sits behind the `games` feature flag
  (docs/feature-flags.md): on in development and staging, off in production until
  launch, and a site moderator can keep it to named members from Moderation,
  Feature flags. Off means invisible: every Games route uses
  `@Feature('games')` and answers 404, the web proxy serves the missing page, and
  the Games link (last in the sidebar, and in the account menu on phones) is
  hidden. New Games routes and jobs check the same flag.
- **Roadmap:** Games entries live in `docs/feature-roadmap.json` as P2. After
  edits, run pnpm roadmap:generate, roadmap:check and roadmap:test.
- **ADR:** one ADR records the games architecture, the Lichess dependency, keno
  being free to play, and known limitations.
- **Data export:** includes game data (profiles, scores, keno tickets, the linked
  Lichess username, but never tokens). Bump the export format when it changes.
- **README:** keep it current with any new commands and environment variables.

## Tests and working agreements

- **API tests** against a real Postgres (pnpm test): keno seed derivation and
  verification, payout scoring, daily cap, XP and season scoring, leaderboard
  ranking (including blocks and suspensions), and the Lichess client with the
  HTTP layer mocked.
- **Playwright:** targeted runs only (pnpm e2e games, or -g by title), with
  newMember from e2e/lib/members.ts. Never run the full suite locally; follow
  AGENTS.md.
- **Checks:** pnpm typecheck must pass. Check every new page in the browser at
  390px and on desktop, in light and dark themes.
- **Workflow:** one vertical slice at a time. Stage changes, never commit, and
  report what is uncommitted at the end of each phase.

## Build order

1. Core: GamesModule, registry, games schema and migrations, feature flag, the
   folder pointer files, /games homepage with both game cards (coming_soon until
   built), ADR draft.
2. Chess: OAuth linking, profile ratings, challenges and notifications.
3. Chess: Board API play, spectating with hidden replies, result posts.
4. Keno: draw job, provably fair verification, play UI, daily cap, leaderboard.
5. Seasons, Game Score, scoring explainer page, competitions engine.
6. Community to Lichess team linking, and tournaments.

Stop for review after each phase.
