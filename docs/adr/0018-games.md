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

## Phase 4: Keno, free to play (3 November 2026)

Built on "Keno is free to play only" above, with the numbers chosen by the owner:
20 free tokens a member a day, reset at midnight Lagos time; a draw every five
minutes; standings for this month and all time; no Keno posts yet.

### Rules

- Numbers 1 to 80, 20 drawn a round. A ticket is 1 to 10 numbers for one round and
  costs one token; a member may play several tickets in a round. Unused tokens do
  not carry over.
- Tickets go into the next round until 15 seconds before its draw; after that, into
  the round after.
- Points come from a table in code (`keno/payouts.ts`, version `v1`), the shape of
  a common casino table, scaled to points. Each ticket keeps the version it was
  played under, so a new table only changes tickets played after it.
- Settings: `KENO_DRAW_EVERY_MS` (default 300000) and `KENO_DAILY_TOKENS`
  (default 20).

### Provably fair

- Rounds are made two ahead, each with a fresh 32-byte random seed and its SHA-256
  published at once, so a round's hash is public before any ticket for it can be
  bought. Until the draw the seed is sealed with `GAMES_TOKEN_KEY` (TokenBox, bound
  to the round's time) when that key is set, and kept as it is otherwise; it never
  reaches a browser before the draw.
- The numbers come from the seed and the round number alone: for counter 0, 1, 2 …,
  HMAC-SHA256 with the seed as key and `"<round>:<counter>"` as message, read as
  eight unsigned 32-bit big-endian numbers; each below 4,294,967,280 (80 × 53,687,091,
  so every number is equally likely) gives (value mod 80) + 1, skipping numbers
  already drawn, until there are 20 (`keno/draw.ts`).
- Each round's page shows its hash, its seed after the draw and its numbers, checks
  them in the browser with Web Crypto (the same steps, `_components/fair.ts`, tested
  against the same examples as the server), and gives a one-line Node.js command
  that checks it without HeyNaija's page.
- Known limit: whoever runs the servers could read a sealed seed before its draw
  (they hold the key). What the commitment guarantees is that nobody can change the
  numbers after tickets are in: any change would no longer match the published hash.

### The draw job

- A BullMQ job scheduler (`keno-draws`, `every: KENO_DRAW_EVERY_MS`, which BullMQ
  lines up with the clock) runs one job per interval however many API processes
  there are. Each run (`KenoService.tick`) draws every round that is due, each in
  one transaction that takes the round with `FOR UPDATE SKIP LOCKED` and scores its
  tickets, then makes sure the next two rounds exist (a unique `draws_at` keeps them
  single). A run that comes twice, or late, changes nothing.
- The API runs it on start too, so a round missed while it was down is drawn then,
  with its tickets, and its page says it was drawn late.
- It does nothing while the `games` flag is off for everyone, as in production, so
  no rounds pile up there (`FeatureFlags.onForAnyone`).

### Tokens: Postgres decides, Redis first

GAMES.md asks for the daily cap on the existing Redis limiter. Its windows start
at a member's first action, not at midnight, and it has no "how many left", so:
buying a ticket takes the member's advisory lock and counts their tickets since
midnight in Lagos in Postgres, which decides and gives the "14 of 20 tokens left
today" figure, and survives Redis being down. Before that, the Redis limiter counts
a burst limit (30 a minute) and an outer bound on the day, under a key that carries
the Lagos date, so its window is that day.

### Scores and standings

When a round is drawn, in the same transaction: the member's all-time Keno stats
in `game_profiles` (rounds, tickets, points, best match), their points this month
in `season_scores` (a `seasons` row for the Lagos month is made if needed; XP stays
0 until phase 5), and one `keno_round_played` event per member per round. The
leaderboard reads only these rows: this month from `season_scores`, all time from
`game_profiles` with an index on its points. Blocks either way and inactive members
are left out, ties share a rank, and the member's own row shows wherever they
stand. The games homepage shows this month's top five.

## Phase 5: seasons, the Game Score, scoring explainer and competitions (4 November 2026)

With these choices by the owner: the XP table below, competitions for Keno only
until chess tournaments arrive with Lichess team linking (phase 6), results posted
by The Arbiter in a new Game Night community, and the explainer kept behind the
`games` flag until launch.

### Seasons and XP

- A season is a Lagos calendar month (`core/seasons.ts`), made on demand. All-time
  totals are kept beside it and never reset.
- XP rules live in one place, `core/scoring.ts` (`XP_RULES`, `xpFor`):
  - chess: 10 XP for a game played to the end, +10 for a win, +5 for a draw, 0 for an
    aborted game; rated and casual count alike;
  - Keno: 2 XP for each round a member has a ticket in, +1 per 10 points scored in
    it, at most +20;
  - competitions: 5 XP for playing in one, +100 / +60 / +40 for 1st / 2nd / 3rd, +20
    for 4th to 10th.
- XP is stored on the `game_events` row (`xp`) and added to the totals in the same
  transaction that writes the event: `season_scores.xp` per game and season,
  `game_profiles.stats.xp` per game for all time, and `games.xp_totals` (member,
  period, xp) for the Game Score per season and for all time. An event is counted
  exactly once because its XP and the totals change together.
- Events from phases 3 and 4 had no XP. On start the API scores any event whose
  `xp` is null, in batches taken with `SKIP LOCKED`, so the backfill is safe to run
  again or in two processes.
- `/games/scoring` ("How games scoring works") reads the same rules from
  `GET /v1/games/scoring`, so the page cannot state a number the scoring does not use.

### Leaderboards

`core/leaderboards.ts` serves every board from the precomputed rows: the Game Score
(`xp_totals`), Chess (XP in chess) and Keno (points), for any season or all time,
for everyone, the people the viewer follows (and them), or the members of a
community. Blocks either way, mutes and inactive members are left out, as from
feeds; ties share a rank; the viewer's own row is always given. The Keno board of
phase 4 now uses it too, which adds mutes to it.

### Competitions

- Site moderators make them (`/games/competitions/new`, linked from Moderation):
  a name, the game and format (`keno_points`: most Keno points from tickets in
  rounds drawn during the play window), who can enter (open, one community, or by
  invitation: `games.competition_invites`), the entry window and the play window.
  They can be saved as drafts, changed until entry opens, published and cancelled.
- A BullMQ job scheduler (`games-competitions`, every minute, one run however many
  API processes) moves them on: open → live at the start; finished once the end
  has passed and every Keno round drawing before it is drawn. It does nothing while
  Games is off for everyone.
- Members enter or withdraw while entry is open. Live scores are kept as rounds
  are drawn: the Keno draw adds each entrant's points from that round to
  `competition_entries.score` in the same transaction.
- Finishing (once, `SKIP LOCKED`): places by score, ties sharing; only members who
  played get one; one `competition_placed` event each, with its XP; then The
  Arbiter posts the top ten (names, not @handles, so nobody is pinged) in Game
  Night, or in the competition's own community. A competition nobody played
  finishes with no post.
- No notifications yet: entrants follow the page, and the result is a public post.

### Game Night and The Arbiter

Game Night (`game-night`) is made on start beside Chess Arena, with The Arbiter as
its moderator. Only The Arbiter starts posts in either (`ARBITER_ONLY` in
`chess/arena-ids.ts`); members reply, and composers do not offer them. The
Arbiter's bio now says it posts game threads and results for HeyNaija Games.

### Games homepage

Your Game Score this season, your rank and your all-time XP; the season
leaderboard with a tab per board; live and upcoming competitions; and The
Arbiter's latest posts from Game Night and Chess Arena, through the normal post
list so blocks and mutes apply.

## Phase 6: community Lichess teams and tournaments (5 November 2026)

A HeyNaija community can link a Lichess team and run Arena and Swiss tournaments
for it. The owner chose: a moderator of the community who leads the team on
Lichess links it and makes its tournaments; games are played on lichess.org;
Arena and Swiss; Game Score XP for places only.

### Linking a team

- `games.community_teams`: one team per community and one community per team,
  with the team's name and size as Lichess last said (read again on view at most
  once an hour), and who linked it.
- To link, the member must moderate the community, have Lichess connected, and be
  listed by Lichess as one of the team's leaders (`GET /api/team/{id}`, public).
  Lichess lists only leaders who are publicly visible; a hidden leader cannot link.
- A community moderator or a site moderator can unlink. Tournaments already made
  run to the end and finish as usual.

### Permission to make tournaments

Making a tournament needs `tournament:write`, which only moderators who run
tournaments are asked for: "Allow tournaments" on the community's chess page runs
the usual PKCE linking with the extra scope (`lichess_link_attempts.scopes`
remembers what was asked), and the new token replaces the old one. The scopes
granted are kept on `lichess_accounts.scopes`. A cookie brings the moderator back
to the community's page from the callback.

### Tournaments are competitions

- Made on Lichess first, with the moderator's own token, after checking again that
  they lead the team: an Arena (`POST /api/tournament`, entry limited to the team
  with `conditions.teamMember.teamId`) or a Swiss (`POST /api/swiss/new/{team}`).
  Then a chess competition for the community: format `lichess_arena` or
  `lichess_swiss`, the tournament's id (`competitions.lichess_tournament_id`) and
  its settings. If saving it fails, the tournament is ended on Lichess.
- What is offered is what Lichess accepts: names of 2 to 30 characters; the clocks
  in `TOURNAMENT_CONTROLS` (Blitz, Rapid and Classical; no Bullet, since games are
  not played through the Board API here, Blitz is fine); Arena lengths that leave
  room for 3 to 150 games (Lichess's rule); 3 to 15 Swiss rounds; a start 10
  minutes to 60 days ahead. Lichess allows 12 tournaments a day per account; so
  does `chessTournament`.
- Members join and play on lichess.org (they must be in the team). HeyNaija has no
  Enter button for these: the HeyNaija members of the community who have connected
  Lichess are matched from the results.
- A job scheduler (`chess-tournaments`) reads the state and results of tournaments
  that have started, from Lichess's public endpoints, at most every
  `CHESS_STANDINGS_EVERY_MS` (two minutes) each and 20 a run, oldest first, and
  stops the run if Lichess says to slow down. Each read replaces the competition's
  entries with the matched members (score; Swiss points doubled so half points are
  whole; and their rank on Lichess, `competition_entries.source_rank`).
- When Lichess says it has finished, it finishes as any competition, but placed in
  Lichess's order (its tiebreaks), with no shared places; the usual placement XP,
  and The Arbiter's post in the community with the Lichess link. A tournament
  Lichess has not finished a day after it was due is finished from the last
  standings read, and the post says so.
- Its maker (while still a moderator of the community) or a site moderator can
  cancel it; it is ended on Lichess with the maker's token when that works, and
  the page says when it may still run there. The Keno cancel route refuses
  tournaments so this one is always used.

## Data export and account deletion

- The export is `heynaija-export/17`: a `games` section with the member's game
  profiles, season scores and competition entries, the linked Lichess account
  (username, when linked, ratings; never the token), their chess challenges and the
  games they played, with every move, their Keno tickets (round, numbers, hits,
  points, when), their Game Score per season and all time, and the competitions
  they were invited to, and the Lichess teams they linked to a community.
- No member foreign key in `games` cascades (ADR 0016). Erasing an account
  deletes the member's game profiles, season scores, competition entries and game
  events; competitions a moderator created stay, pointing at the tombstone. A
  linked Lichess account's token is revoked at Lichess before the erase, and the
  account, any linking under way, every challenge and every game the member was in
  are deleted (their notifications go with them). The Arbiter's threads and results
  stay, as posts that name the tombstone. Their Keno tickets are deleted; the shared
  rounds stay. Their Game Score totals and competition invitations are deleted. A Lichess team
  they linked stays linked to its community, with who linked it forgotten.

## Known limitations

- A game's status is code, so changing it needs a deploy.
- Game slugs are not checked by the database; a typo in code would store rows
  for a game that does not exist.
- Spectator replies are hidden from both players until a game ends as a courtesy,
  not anti-cheat: anyone can watch the game on lichess.org.
- Keno competitions are made by site moderators and chess tournaments by
  community moderators who lead the Lichess team; entrants are not notified when
  one starts or ends.
- Whether a moderator still leads the Lichess team is checked when they link it
  and when they make a tournament, not afterwards; tournaments already made run to
  the end. Tournament games give no per-game XP, only places do.
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
- Keno: the operator could read a sealed seed before its draw (see Phase 4); the
  hash only proves the numbers were not changed afterwards. At every draw each open
  Keno page asks for it within a few seconds of the others.

## Rollback

Revert the code. Then, before any real game data exists:
`alter table notifications drop column challenge_id;`, put
`notification_opt_outs_kind_check` back without `chess_challenge` and
`chess_game_started` (after deleting those rows), `alter table notifications drop
column game_id;`, `drop schema games cascade;`, delete The Arbiter's posts and
membership, Chess Arena and The Arbiter's member row, and delete the
`0035_games_core`, `0036_chess_linking`, `0037_chess_play`, `0038_keno`, `0039_games_scoring` and `0040_games_teams` entries from
`drizzle.__drizzle_migrations` (and `packages/db/drizzle/meta/_journal.json`).
Put `EXPORT_FORMAT` back only together with the code that reads the tables.
