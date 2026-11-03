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

## Phase 2: linking Lichess, ratings and challenges (3 November 2026)

Built on the decisions above, with these choices made by the owner before it
started: tokens encrypted with a key from the environment, the challenge
notification in the app, by email and by push (and optional, like the others),
any two members who have both linked Lichess may challenge each other, linking
only on the chess page, and Chess marked Beta on /games.

### Linking (OAuth2 with PKCE)

- "Connect Lichess" on /games/chess asks the API for an address
  (`POST /v1/games/chess/link`) and sends the member there. Lichess knows
  HeyNaija by its host (`client_id` is the host of `WEB_PUBLIC_URL`: heynaija.ng
  in production), with no secret and no registration, and asks only for
  `challenge:read`, `challenge:write` and `board:play`.
- Lichess sends the member back to `/games/chess/callback`, a route handler in the
  web app, which passes the code and state to the API with the member's session.
  The browser never holds a token.
- The state and the PKCE verifier are kept in Postgres
  (`games.lichess_link_attempts`), not a cookie or Redis: the state only as a
  SHA-256 hash, the verifier sealed, for ten minutes, deleted as it is used, and
  only for the member who started it. A replayed or someone else's callback does
  nothing.
- One Lichess account belongs to one member. Unlinking revokes the token at
  Lichess where it can, and forgets it either way.

### Tokens at rest

`GAMES_TOKEN_KEY` (32 bytes as 64 hex characters, made by `pnpm infra:env` and
`infra/deploy/gen-env.sh`) seals tokens with AES-256-GCM (`TokenBox`), with the
member's id bound in, so a sealed token copied to another member's row does not
open. Boxes carry a version (`v1.`) so the key can be changed later. Without the
key, linking is simply not offered. **Losing the key loses nothing but the
links:** every member connects Lichess again.

### Ratings

Blitz, Rapid, Classical and Correspondence ratings are read when an account is
linked, on demand (a Refresh button, six times an hour), and every six hours by a
BullMQ job that reads up to 300 accounts in one call to Lichess's public
`/api/users`, which needs no token. They are shown on the chess page and, to
members with Games, on profiles, with the Lichess username: it is public on
Lichess already.

### Challenges, made on Lichess only when accepted

A challenge is a row here (`games.chess_challenges`) until the challenged member
accepts. Then the API makes the challenge on Lichess with the challenger's token
and accepts it straight away with the other's; the Lichess challenge id is the
game. If accepting fails it withdraws the Lichess challenge and the one here stays
open. Why: an unaccepted challenge on Lichess runs out on Lichess's own timetable,
and a member deciding tomorrow would find nothing there; holding both tokens, the
API can make the game at the moment both have said yes.

- Rated or casual, a colour, and one of a fixed list of time controls the Board
  API allows for direct challenges: Blitz 3+2, 5+0, 5+3; Rapid 10+0, 10+5, 15+10;
  Classical 30+0, 30+20; Correspondence 1, 3, 5 or 7 days a move. No Bullet. The
  API refuses anything else, and the page offers exactly this list.
- Both members must have linked Lichess and have Games, and neither may block the
  other; a blocked member reads as one who has not linked. One open challenge per
  pair. An open challenge runs out after a day (a week for correspondence),
  worked out when read: nothing sweeps it.
- One Lichess request at a time per member: each member's calls take a Postgres
  advisory lock. A 429 from Lichess is passed on as "try again in a minute", and
  the scheduled job stops until its next run.
- The notification (`chess_challenge`) says who and what game, links to the
  challenge, and disappears once the challenge is settled or runs out, so it is
  never emailed or pushed late.

## Phase 3: playing and watching here, Chess Arena and results (3 November 2026)

Owner's choices before it started: game threads grouped in a community of their
own, **Chess Arena**, looked after by an automated account, **The Arbiter
(`@arbiter`)**; a thread only when the challenger asks (a box, ticked by default);
the result as The Arbiter's reply in that thread; live games listed on the chess
page and shown on profiles.

### Live games without a stream to the browser

Nothing in HeyNaija streamed to the browser, and in deployment it would not get
through unchanged: nginx buffers responses and closes one with nothing sent for 60
seconds, and the web app compresses what it passes on. So the browser **long-polls**:
`GET /v1/games/chess/games/:id?after=<version>` answers at once if the game has
changed since that version, and otherwise waits up to 25 seconds for the next
change. One plain answer at a time; nginx, Cloudflare and the web app need nothing
new.

The streaming happens between servers. For each game being played, one BullMQ job
(`GameWatcher`, with the game's id as the job id, so one per game however many API
processes there are) holds the Board API stream open with a player's token, keeps
`games.chess_games` up to date and raises `version`, and sends
`pg_notify('chess_game', id)`. Each API process keeps one `LISTEN` connection
(`GameEvents`) and wakes its waiting requests. A dropped stream is opened again,
backing off; when the API starts it picks up every unfinished game.

Players move, offer, accept or decline draws, resign and abort with their own
token (`/move`, `/draw`, `/resign`, `/abort`); Lichess decides what is legal and the
board goes back if it says no. "Either colour" is settled before the game is made
on Lichess, so HeyNaija knows who is white. The board is chessground and chessops,
loaded only on a game page (`import()`), as the Gists audio library is; they are
GPL-3.0-or-later and named on `/licence`. The board's squares use the existing
tokens. A challenger is told when their game starts (`chess_game_started`, in the
app, by email and by push, under the same Settings box as challenges).

### The Arbiter, HeyNaija's first automated account

Every post has a member as its author, and there is no system account. Posting a
game's thread in a player's name would have them say something they did not
write; a person moderating Chess Arena is not needed yet. So HeyNaija has its first
automated account: The Arbiter. It is a member row with a fixed id, made when the
API starts (`ensureArena`) together with Chess Arena and its place as Chess Arena's
moderator. It has no sign-in: nothing in Kratos, so nobody can sign in to it, and
its handle is reserved (`RESERVED_HANDLES`), so nobody can take it. It carries an
`automated` badge, shown as "Automated" beside its name on posts and "Automated
account" on its profile, and is notified of nothing. If someone already had
`@arbiter`, it takes `@arbiter_hn` and leaves theirs alone.

In Chess Arena only The Arbiter starts posts; members reply, without joining. The
Arbiter never takes moderation actions: reports about Chess Arena reach the site
moderators, who already cover every community, until a person is appointed.

### Spectators' replies hidden from the players

While a game is on, replies in its thread by anyone but the two players are
hidden from the two players: one predicate (`hiddenFromPlayer`) in the query every
post goes through for display, in thread replies, in reply previews and quotes,
and in reply and mention notifications, which wait until the game ends rather than
being lost. Once it ends, everything shows. The page says plainly it is a courtesy,
not anti-cheat: anyone can watch on lichess.org. Known limit: a post's reply count
includes the hidden replies, so the players can see that people are talking, not
what they say.

### When a game ends

The watcher sees Lichess's final status and, once: marks the game finished, reads
both players' new ratings, writes a `chess_game_finished` event per player (what
phase 5 will score) and the all-time tallies in `game_profiles`, and has The Arbiter
reply in the thread with the result and the rating changes.

## Data export and account deletion

- The export is `heynaija-export/14`: a `games` section with the member's game
  profiles, season scores and competition entries, the linked Lichess account
  (username, when linked, ratings; never the token), their chess challenges and the
  games they played, with every move. Keno tickets join it in their phase.
- No member foreign key in `games` cascades (ADR 0016). Erasing an account
  deletes the member's game profiles, season scores, competition entries and game
  events; competitions a moderator created stay, pointing at the tombstone. A
  linked Lichess account's token is revoked at Lichess before the erase, and the
  account, any linking under way, every challenge and every game the member was in
  are deleted (their notifications go with them). The Arbiter's threads and results
  stay, as posts that name the tombstone.

## Known limitations

- A game's status is code, so changing it needs a deploy.
- Game slugs are not checked by the database; a typo in code would store rows
  for a game that does not exist.
- Spectator replies are hidden from both players until a game ends as a courtesy,
  not anti-cheat: anyone can watch the game on lichess.org.
- Only site moderators can create competitions for now.
- Signed-out visitors cannot see Games at all; whether `/games` should be public
  once it is launched is decided then.
- On staging every member sees Games unless a moderator limits the flag, by the
  flag policy. Connecting Lichess there needs `GAMES_TOKEN_KEY` in its `.env`.
- Long correspondence games keep a stream open for days, and every game being
  played holds one connection to Lichess from one API process; measure before
  growth.
- The board's move dots are drawn with a hard-stop circle; nothing else on the
  board uses a gradient.
- A challenge is not withdrawn when one member blocks the other; it is hidden from
  both and runs out.

## Rollback

Revert the code. Then, before any real game data exists:
`alter table notifications drop column challenge_id;`, put
`notification_opt_outs_kind_check` back without `chess_challenge` and
`chess_game_started` (after deleting those rows), `alter table notifications drop
column game_id;`, `drop schema games cascade;`, delete The Arbiter's posts and
membership, Chess Arena and The Arbiter's member row, and delete the
`0035_games_core`, `0036_chess_linking` and `0037_chess_play` entries from
`drizzle.__drizzle_migrations` (and `packages/db/drizzle/meta/_journal.json`).
Put `EXPORT_FORMAT` back only together with the code that reads the tables.
