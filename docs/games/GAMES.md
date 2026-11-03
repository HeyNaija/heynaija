# Games module

The standing specification for HeyNaija's Games section. Every person and coding
agent working on games code reads this first: `apps/api/src/games`,
`apps/web/app/games`, and the `games` database schema. If a change conflicts with
this document, stop and ask rather than working around it. Change this document
in the same pull request as any agreed change to the rules.

Progress and status are not tracked here. They live in `docs/feature-roadmap.json`
(rendered at `/progress`), like every other feature.

Also read before starting: PLAN.md, PRODUCT.md, AGENTS.md, apps/web/DESIGN.md,
the games ADR, and ADRs 0002, 0005 and 0014.

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
apps/web/app/games/
  page.tsx             games homepage
  AGENTS.md, CLAUDE.md pointers to this document
  _components/         shared game UI: cards, leaderboard, competition strip
  chess/               routes + _components (board, challenge flow, rating
                       card, live view)
  keno/                routes + _components (number picker, draw board,
                       ticket history, verify page)
```

The pointer files: `AGENTS.md` says "Read docs/games/GAMES.md before changing
anything in this folder." `CLAUDE.md` contains `@AGENTS.md`.

Database: game tables live in a separate Postgres schema, `games`, mirroring how
`restricted.*` is kept apart, with Drizzle migrations in `packages/db/drizzle`.
Lichess OAuth tokens are encrypted at rest and never returned to the browser.

The game registry and manifests live in the API, which is the source of truth for
each game's status (live, beta, coming_soon). The web app reads them through
`/api/v1/games`.

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
  in the spirit of /about/discover.
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
   registration. The callback goes through the web app's single origin to the
   API. Request only the scopes needed: challenge:read, challenge:write and
   board:play first; team and tournament scopes only when community tournaments
   are built. Unlinking deletes the token.
2. **Profile:** the Lichess username, plus Blitz, Rapid, Classical and
   Correspondence ratings, cached and refreshed on a schedule and on demand.
3. **Challenges:** a member challenges another member who has linked Lichess.
   Rated or casual. Time controls are limited to what the Board API allows (no
   Bullet; Blitz only for direct challenges), enforced in the UI and the API. The
   challenged member gets an in-app notification through a new notification
   kind, with an opt-out like the others.
4. **Play inside HeyNaija** through the Board API: stream game state, move, offer
   or accept draws, resign, and reconnect cleanly. Respect Lichess rate limits:
   one request at a time per member, and back off on 429. Use chessground and
   chessops (GPL-3, which can be combined with our AGPL licence). Lichess is the
   source of truth for legality and results.
5. **Spectating:** a live board fed by Lichess's public game stream, plus a
   discussion thread. Spectator replies are hidden from both players until the
   game ends. The UI says this is courtesy, not anti-cheat, since anyone can
   watch the game on lichess.org.
6. **Results:** on game end, fetch the result and new ratings from Lichess, write
   a game_event, award XP, and create a result post linked to the match
   discussion.
7. **Community tournaments:** existing HeyNaija communities can link to a Lichess
   team, enabling Arena and Swiss tournaments created through the API.

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
- **Daily play cap,** enforced with the existing Redis rate limiter.
- Optional posts for draw results and notable wins.

## Competitions engine

Shared across games: name, game, format, eligibility (open, community, invite),
entry window, schedule, standings source (Lichess tournament results for chess,
points within a draw window for keno), status lifecycle, and results published
as posts. Only site moderators can create competitions for now.

## Feature flag, roadmap and docs

- **Feature flag:** the whole Games module sits behind a flag, following however
  the repo already gates features. Off by default.
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
