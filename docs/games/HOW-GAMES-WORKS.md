# How Games works

A plain guide to the Games section of HeyNaija: what members can do, what
moderators do, and what the people running the site need to know. For the
technical detail, see [GAMES.md](GAMES.md) and
[ADR 0018](../adr/0018-games.md).

## In one paragraph

Games is a section of HeyNaija with two games: **Chess** and **Keno**. Chess is
played on Lichess, the free chess site, but members can challenge each other,
play and watch from inside HeyNaija. Keno is our own number game, free to play,
with free daily tokens. Playing earns **XP** (experience points) that adds up to
a member's **Game Score**, and there are monthly leaderboards and competitions.
There is **no money anywhere**: nothing can be bought, sold, sent to someone
else or swapped for anything.

## Where to find it

- **Games** is the last link in the sidebar (on phones, it is in the account
  menu). It opens `/games`.
- The Games page shows your Game Score this month and a grid of the games, each
  with its logo. Open a game to play it; each game's page also has tabs for its
  **Leaderboard**, **Competitions** and **Posts**.
- If Games is switched off for you, you don't see the link, and Games pages
  show "Nothing here". See [The switch](#the-switch).

## Chess

Lichess runs the actual games, the ratings and the fair-play checks. HeyNaija
adds the social side: challenges, watching, talking, results and tournaments.

### Connecting Lichess

1. Go to **Games → Chess** and press **Connect Lichess**.
2. Lichess asks you to say yes. HeyNaija only asks to make and accept
   challenges and to play your games.
3. You come back to HeyNaija, connected. Your Lichess username and ratings
   (Blitz, Rapid, Classical, Correspondence) now show on your profile.

- Ratings update by themselves every few hours, or straight away with
  **Refresh ratings**.
- **Disconnect** gives the key back to Lichess, and HeyNaija forgets it.
- The key is stored locked (encrypted). Nobody at HeyNaija sees it.

### Challenging someone

- You can challenge any member who has also connected Lichess, from their
  profile or from the Chess page. You can't challenge someone you have blocked,
  or who has blocked you.
- Choose a time control from the list, rated or casual, and your colour.
- They get a notification in the app, by email and by push. Members can turn
  these off in their notification settings.
- A challenge waits a day (a week for correspondence games), then runs out.
- When they accept, the game is made on Lichess and both of you get a link to
  play it.

### Playing and watching

- You play on a board inside HeyNaija. Moves, draw offers and resigning all go
  to Lichess, which decides what is legal and who won.
- The Chess page lists games being played right now, and anyone with Games can
  watch.
- If the challenger ticked **Open a public thread**, a bot account called
  **The Arbiter** starts a post about the game in the **Chess Arena** community.
  Others can talk about the game there.
- While the game is on, the two players **don't see the replies** in that
  thread. This is a courtesy so nobody gets hints. It is not real anti-cheat:
  anyone can watch the game on lichess.org.
- When the game ends, The Arbiter replies in the thread with the result and the
  new ratings, and the players can see every reply.

### Community tournaments

A community on HeyNaija can link its team on Lichess and run tournaments for it.

- **Who sets it up:** a moderator of the community who is also a leader of the
  team on Lichess. They open **Chess for (community)**, which is linked from the
  community page, paste the team's Lichess address and press **Link team**.
- **Permission:** to make tournaments, Lichess asks the moderator one more time
  to let HeyNaija make them in their name. Only moderators who run tournaments
  are asked this.
- **Kinds:**
  - **Arena:** play as many games as you can before time runs out.
  - **Swiss:** a set number of rounds, each against someone on a similar score.
- **Playing:** members play on lichess.org, and must be in the team there. The
  tournament page on HeyNaija has **Join on Lichess** and **Join the team**.
- **Standings:** every couple of minutes HeyNaija reads the standings from
  Lichess. It shows the community's members who have connected Lichess, in
  Lichess's order, with their rank there.
- **When it ends:** the HeyNaija players get places and XP, and The Arbiter
  posts the results in the community.
- **Cancelling:** the moderator who made it, or a site moderator, can cancel
  it. That also ends it on Lichess when Lichess allows.

## Keno

Keno is a number game we run ourselves. It is **free**: no money goes in, and
none comes out.

### How to play

1. Pick **1 to 10 numbers** from 1 to 80.
2. Play the ticket. It costs **1 token**. Every member gets **20 free tokens a
   day**, and they reset at midnight Lagos time.
3. A draw happens **every 5 minutes**: 20 numbers out of 80. Tickets close 15
   seconds before each draw; a later ticket goes into the next draw.
4. The more of your numbers come up, the more **points** you get. The points
   table is on the Keno page. For example, with 1 number picked, a match is
   worth 3 points; with 10 picked, all 10 matching is worth 50,000.

### Why you can trust the draw

Before each draw, HeyNaija publishes a code (a "fairness hash") that locks in
that round's numbers. After the draw, it shows how the numbers were made. Anyone
can open a round's page and check that the numbers match what was locked in
beforehand. So the numbers can't be changed after people have played.

## Game Score, seasons and leaderboards

### XP: how you score

| What you did | XP |
| --- | --- |
| Finished a chess game | 10 |
| ...and won it | +10 more |
| ...or drew it | +5 more |
| Played a Keno round | 2, plus 1 for every 10 points it scored (up to 20 more) |
| Took part in a competition | 5 |
| Came 1st, 2nd or 3rd | +100, +60 or +40 more |
| Came 4th to 10th | +20 more |

- A chess game that was aborted before it really started gives nothing.
- Your **Game Score** is all your XP added together.
- The full rules are on **How games scoring works** (`/games/scoring`). That
  page reads the same rules the scoring uses, so it is always right.

### Seasons

- A **season** is one calendar month, Lagos time.
- Each season's leaderboards start empty on the 1st.
- All-time totals are kept separately and never reset.

### Leaderboards

- **Game Score:** all games together, from **Leaderboard** beside your Game
  Score on the Games page (`/games/leaderboard`).
- **Each game's own board:** the **Leaderboard** tab on that game's page
  (Chess: XP from chess; Keno: Keno points).

Every board has:

- **Periods:** this season, a past season, or all time.
- **Who is on it:** everyone, people you follow, or the members of a community
  you are in.
- **Who is left out:** people you have blocked or muted, anyone who has blocked
  you, and suspended members.
- **Ties** share a place.
- **Your own row** always shows, even if you are far down.

## Competitions

### How they work

- A competition has a name, who can enter and when it runs. Entry can be open
  to everyone, to one community, or by invitation only.
- Members press **Enter** while entry is open, and can withdraw until it
  closes.
- Standings update while it runs.
- **When it ends:**
  - players get places (ties share a place) and XP;
  - The Arbiter posts the top ten in the **Game Night** community, or in the
    competition's own community.
- The result post uses names, not @handles, so nobody gets pinged.

### Kinds of competition

- **Keno competitions:** the most Keno points from tickets drawn during the
  competition. Only **site moderators** make these, from **Moderation → Games
  competitions**. They can save a draft, change it until entry opens, publish it
  and cancel it.
- **Chess tournaments:** made by community moderators, as described in
  [Community tournaments](#community-tournaments). Members join on Lichess, not
  with an Enter button.

### Game Night and Chess Arena

- Both are communities made automatically.
- Only The Arbiter starts posts there. Members reply and talk.
- **Chess Arena** has game threads; **Game Night** has competition results.

### Not built yet

Members aren't notified when a competition starts or ends. They follow the
competition's page, and the result is posted publicly.

## The Arbiter

The Arbiter (`@arbiter`) is HeyNaija's automated account. It is marked as
automated on its profile, nobody can sign in as it, and it only posts about
games:

- chess game threads and results in Chess Arena;
- competition results in Game Night, or in a community;
- tournament results in the community that ran the tournament.

## No money, ever

- XP, points and Keno tokens can't be bought, sold, sent to someone else or
  swapped for anything. They only count for the leaderboards.
- Keno played for money is a licensed lottery in Nigeria, so any idea of adding
  prizes needs a lawyer first.

## Privacy and your data

- **Your data export** includes your game history:
  - your scores;
  - your Keno tickets;
  - your chess challenges and games, with every move;
  - your competitions;
  - your Lichess username;
  - any Lichess team you linked.

  It never includes your Lichess key.
- **Deleting your account:**
  - your Lichess key is given back to Lichess;
  - your game history, tickets and scores are deleted;
  - posts The Arbiter made about your games stay, as posts, naming the deleted
    account.
- Blocks and mutes apply in Games too: on leaderboards, standings, challenges
  and game posts.

## For moderators

- **Site moderators:**
  - can switch Games on or off, or on for named members only: **Moderation →
    Feature flags → games**;
  - make Keno competitions: **Moderation → Games competitions**;
  - can cancel any competition or tournament, and unlink any community's Lichess
    team.
- **Community moderators** who lead their community's Lichess team can link it
  and make tournaments, from the community page (**Set it up** or **Manage**).

## For the people running the site

### The switch

Games sits behind the `games` feature flag:

- **Development and staging:** on.
- **Production:** off until launch.

When it is off for someone, Games doesn't exist for them: no link, no pages,
and the API answers "not found". Background jobs (draws, competitions,
tournaments) do nothing while Games is off for everyone.

### Settings (in `.env`)

| Setting | What it does | Default |
| --- | --- | --- |
| `GAMES_TOKEN_KEY` | The key that locks members' Lichess keys (64 hex characters; `pnpm infra:env` adds one). Without it, connecting Lichess isn't offered. | none |
| `LICHESS_URL` | Where Lichess is. Only changed for testing. | `https://lichess.org` |
| `KENO_DRAW_EVERY_MS` | Time between Keno draws, in milliseconds. | 300000 (5 minutes) |
| `KENO_DAILY_TOKENS` | Free Keno tokens per member per day. | 20 |
| `CHESS_STANDINGS_EVERY_MS` | How often tournament standings are read from Lichess. | 120000 (2 minutes) |

Staging needs `GAMES_TOKEN_KEY` set before anyone can connect Lichess there.

### Things to know

- **Lichess limits:** chess depends on Lichess being up. If it is down or busy,
  chess actions say so and ask members to try again in a moment.
- **Tournaments per day:** Lichess lets one account make 12 tournaments a day.
- **Team leaders:** a moderator who stops being a leader of the Lichess team
  can't make new tournaments, but ones already made run to the end.
- **Late tournaments:** if Lichess still hasn't finished a tournament a day
  after it was due to end, HeyNaija finishes it from the last standings it read,
  and the result post says so.
- **Keno draws:** the draw job is safe to run on several servers at once; each
  round is drawn once.
- **Signed-out visitors:** they can't see Games at all. Whether to make it
  public is decided at launch.
