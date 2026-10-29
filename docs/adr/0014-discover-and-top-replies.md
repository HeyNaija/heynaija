# ADR 0014 — Discover: a third feed ranked by published rules, and a Top order for replies

**Date:** 28 October 2026 · **Status:** Accepted, amended the same day
(Discover is the first and default tab, for visitors too; see
[Amendment](#amendment-28-october-2026-discover-is-the-default)). Discover
built 28 October 2026; Top not yet built ·
**Amends:** the "Feeds in time order" promise in the charter
(`apps/web/app/(main)/charter/page.tsx`) and the privacy policy, when Discover
ships; [ADR 0013](0013-reply-order.md), by adding a third reply order

## Decision

Latest and Following stay as they are: newest first, not ranked.

Members get a third feed, **Discover**: recent posts ranked by rules published on
the site, worked out only from what anyone can already see on HeyNaija, with a
line on every post saying why it is there. It is a choice. Latest stays the
default tab. *(Amended: Discover is now the first tab and the default.)*

The replies to the post in focus get a third order, **Top**, beside Newest and
Oldest. Newest stays the default.

Nothing on HeyNaija is ranked by predicting what a member will engage with, by
what they have read or how long they looked at it, by follower counts, or by
payment.

## Why

- With up to 200 members in the pilot, a member can read all of Latest today.
  Once more is posted than a member reads in a visit, newest first hides the
  conversations that got going while they were away. A newcomer who follows
  nobody sees strangers' posts in the order they happened. Discover is for both.
- X ranks its For You feed with a transformer that predicts about twenty actions
  per post, from likes and replies to dwell time, mutes and reports, and adds
  them up with weights
  ([xai-org/x-algorithm](https://github.com/xai-org/x-algorithm)). Threads ranks
  For You by predicted likes, reply clicks, follows and scrolling past, and does
  not publish the weights; its Following feed stays in time order. Both learn
  from impressions and time spent looking, which HeyNaija does not record and
  would not want to. They are also the opaque ranking HeyNaija set out against.
- Bluesky keeps Following in time order as the default and offers Discover as a
  feed you can remove. Its custom feeds are separate services that return a list
  of post IDs. Discover takes that shape: one more feed, chosen by the member,
  with its rules shown, behind an interface that could move into its own
  service.
- Using only public activity means Discover tells nobody anything they could
  not find out already. Who liked a post is not public here (only its author is
  told), so likes count only as the post's public total. Discover never names or
  counts the people you follow who liked something. Replies, quotes and reposts
  are public, under the post or on profiles, so Discover can name them.
- One formula with stated numbers, the same for everyone plus the reader's own
  follows and communities, can be checked: anyone can work out why a post is
  where it is. Trending topics already work this way (`/topics`).
- Ranking gives a post reach it would not otherwise have. So a post that two or
  more members have reported waits out of Discover until a moderator decides.
  It stays everywhere else.
- Discover ends: 100 posts at most, then it points to Latest. A ranked feed with
  no end is the "keeps you scrolling" design the charter rules out.
- On a busy post, newest first puts the latest one-liners above the answers
  people found useful. X, Threads and Bluesky all rank replies by default: X
  looks at whether the reader follows the replier and whether they pay for
  Premium, and Bluesky's switch to "hot" replies by default in November 2024
  drew complaints. HeyNaija keeps Newest as the default and offers Top as a
  choice, with a stated rule and nothing personal or paid.

## How Discover ranks

Opening Discover fixes a moment, `asOf`. Everything below is worked out as of
that moment, and every page of that visit uses the same one.

### Which posts

Top-level posts that are:

- posted in the 72 hours before `asOf`;
- live, by an active member the reader can see (no block either way, not
  muted), the same rules as every feed;
- not the reader's own;
- not under open reports from two or more different members, or one from the
  image scanner;
- worth at least one point.

Replies are not shown on their own. Their activity counts toward the post they
are under.

### Points

| For each | Points |
| --- | --- |
| Different member, other than the author, who replied anywhere in its conversation or quoted it | 2 |
| Like (its like count) | 1 |
| Repost (its repost count) | 1 |
| Person the reader follows and can see, among those who replied, quoted or reposted | 3 more |
| The reader follows its author | 2 |
| It is in a community the reader joined | 1 |

Only actions up to `asOf` count: by active members, on replies and quotes that
are still live. The first three rows are the same for every reader.

### Score

```
score = points / (hours since posted + 2) ^ 1.5
```

As on Hacker News, a post loses ground as it ages. A busy post from this
morning sits above a busier one from two days ago, and a quiet post from an
hour ago can sit above both. The `+ 2` stops a brand-new post from scoring
without limit.

Then the posts are spread out: taking each author's posts best first, the
second scores half, the third a quarter, and so on.

Discover is in score order, highest first, ties by ID, up to 100 posts, 30 a
page like the other feeds.

### Why each post is there

The first that applies:

1. Someone the reader follows replied, quoted or reposted: "@ade replied",
   "@ade quoted this", "@ade reposted", with "and 2 others you follow" when
   there are more. The one named is the latest to act.
2. The reader follows its author: "You follow @ade", as in Following.
3. It is in a community the reader joined: "From Lagos, which you joined", as in
   Following.
4. Otherwise: "Active on HeyNaija".

### Paging

A ranked list cannot be paged by time. The cursor is `[1, asOf, score, id]`.
Every page ranks again as of the same moment and continues after that score and
ID. Posts, likes and reposts all have `created_at`, so nothing new moves the
list and nothing is stored per member. The score travels as Postgres prints
it, which reads back as the same number, so the boundary compares exactly. A
cursor of any age continues the ranking it began.

The first page returns `asOf`, and the page puts it in its address
(`/?feed=discover&at=…`, `DiscoverMoment`), so a reload after a bookmark, a
follow or a delete asks for the same moment and nothing on screen moves. An
`at` more than an hour old, or one that does not parse, is ignored and the
ranking starts from now. Opening the tab again starts afresh.

Between pages, an unlike, a deleted reply or a suspension can only lower a
post's score, and a block or a takedown removes it, so a post can come round
again further down. The browser drops a post it already shows (`MorePosts`).
Following
someone between pages can lift a post above the cursor, where it is missed
until the next visit.

### Where it runs

In the API, as `PostsService.discover`: one statement ranks and returns post IDs
with their reasons, then the hydration every feed uses (`select`), as trending
does. The ranker takes a reader and `asOf` and returns `{ postId, reason }[]`.
If ranking ever needs its own process, it moves behind that interface and
nothing else changes.

`GET /v1/feed/discover?limit=&cursor=&at=` is for signed-in members. It
returns the page, `asOf` and the rules, the numbers above (`DISCOVER_RULES` in
`apps/api/src/posts/discover.ts`). `GET /v1/feed/discover/rules` returns the
rules alone, with no session, for `/about/discover`, which states them in words
from those numbers, as `/topics` does.

No new table, queue, cache or service. Nothing is stored about what anyone
reads.

### Performance

Measure before release with the load-test kit: a Discover journey in
`k6/journeys.js` on the 20,000-member seed, with the usual targets (p95 under
300 ms, errors under 1%), and `EXPLAIN (ANALYZE, BUFFERS)` on the ranking
statement for a member who follows many and one who follows nobody.

`posts.root_id` has no index, so the statement reads the window's posts,
replies included, from `posts_created_idx` and groups them by `root_id`, rather
than looking up each candidate's conversation. Likes and reposts are read by
post from their primary key and `reposts_post_created_idx`. If it is too slow:

1. Work out the points that are the same for everyone once a minute, as
   trending does (`Refreshing`), and add each reader's own points on top.
2. Only then, a separate ranking service behind the same interface.

### In the app

- Tabs: Latest, Following, Discover. Discover is for members only, like
  Following. Latest stays the default, and the choice is not saved.
- On Discover, the label beside the tabs reads "Ranked by published rules" and
  links to `/about/discover`, which states the rules with the numbers from the
  API. Latest and Following keep "Newest first, not ranked".
- After the last post, or with nothing to show: "That's Discover for the last
  3 days. Latest has every post, newest first."
- A `discover` kind in `FeedSource`, so "More posts" and its plain link work as
  they do for the other feeds.

## How Top orders replies

- `order=top` on `GET /v1/posts/:id` and `GET /v1/posts/:id/replies`, for the
  replies to the post in focus. Replies in an opened branch stay oldest first
  (ADR 0013, amendment).
- The post author's replies still come first, newest first. Everyone else's are
  in score order, with the same decay as Discover:
  `points / (hours since posted + 2) ^ 1.5`, where points are 2 for each
  different member (other than the reply's author) who answered the reply, and
  1 for each of its likes. Worked out as of `asOf`; ties newest first. Who the
  reader follows and anything paid play no part.
- Reply cursors for Top are version 3 and carry `asOf` and the score. Newest
  and oldest keep version 2.
- Scoring every reply on each page is fine for hundreds of replies, not for the
  10,000 to 100,000 in the thread fixtures ([loadtest-threads.md](../loadtest-threads.md)).
  Until those are measured, Top is offered on posts with up to 2,000 direct
  replies (`TOP_REPLIES_MAX`). Above that, the switch offers Newest and Oldest
  and says why.
- The sentence above the replies says which order is in use. For Top: "@ade's
  own replies come first, then everyone else's, top first: the replies more
  people answered and liked recently. Nothing is ranked by who you follow or by
  payment."

## What changes in public, with Discover

These changed in the same change that built Discover, not before.

- **Charter**, "Promises we keep today": from "Feeds in time order. Posts are not
  ranked by what keeps you scrolling, and feeds say why a post is there." to
  "**Feeds you can check.** Latest and Following are in time order. Discover
  ranks recent posts by rules published on the site, using only what anyone can
  see here, and says why each post is there. Nothing is ranked by what keeps you
  scrolling, and nothing is paid for."
- **Privacy policy**: "Latest and Following are in time order. Discover ranks
  recent posts by published rules, using only public activity (replies, quotes,
  reposts and like counts), who you follow and which communities you joined. We
  do not record what you read, rank posts by guessing what you will engage with,
  show advertising, or sell or rent your data to anyone."
- **About**: the paragraph on feeds names Discover and what it uses, instead of
  "Neither is a personalised recommendation engine". Top joins it when built.
- **Draft constitution**: it lists "chronological feeds" among the charter
  commitments that may change only if disclosed and approved. Its wording
  becomes "time-ordered Latest and Following feeds and published rules for any
  ranked feed". The draft asks that revisions carry a version date and a
  changelog, so this is Draft v0.3.1 (`apps/web/lib/governance.ts`,
  `docs/governance/CHANGELOG.md`).
- **Announcement**: a post in Building HeyNaija sets out Discover, with the
  rules, before it is deployed.

## Amendment, 28 October 2026: Discover is the default

Discover is the first tab and what Home opens on, for members and for visitors
who are not signed in. The tabs are Discover, Latest and, for members,
Following. Home remembers the tab a reader last chose, in a cookie in their
browser (`hn_feed`, a year). Latest and Following do not change.

Three rule changes make it work as the default:

1. **Every post starts with 1 point** (`startingPoints`). Without it a post
   nobody had touched scored 0 and was left out, so as the default a new
   member's first post would have reached almost nobody. A post with only its
   starting point says "New on HeyNaija" (`recent`); "Active on HeyNaija" now
   means someone took part.
2. **The reader's own posts from the last hour come first**, newest first,
   marked "Your post" (`own`). They are read as of now rather than `asOf`, so a
   post just written shows at once on a page kept at its moment. They are not
   ranked, and only the first page has them.
3. **Visitors get Discover.** `GET /v1/feed/discover` takes no session. With no
   reader, only the points that are the same for everyone count (the starting
   point, people in the conversation, likes, reposts). That ranking is the same
   for every visitor, so it is worked out once a minute
   (`visitorRefreshSeconds`) and shared; a visitor's later page from a ranking
   since replaced is ranked again as of its own moment.

Why: X and Threads open on their ranked feeds. With the rules published and
every post explained, a ranked default keeps the charter's wording, which says
what each feed uses rather than which opens first. The pilot measures first
sessions and weekly posters: a newcomer who follows nobody opens on the busiest
conversations and their communities, and the starting point keeps a new post
from going unseen.

Addresses: `/` opens the default; `/?feed=discover`, `/?feed=latest` and
`/?feed=following` name a tab and are what the tabs link to (choosing one sets
the cookie); Latest's older pages are `/?feed=latest&cursor=…`. Opening
Discover puts its moment in the address (`/?feed=discover&at=…`).

Consequences: in Latest every new post was at the top for everyone; in Discover
a stranger's new post is placed by its score. At the pilot's size, with fewer
than 100 posts in three days, that is still nearly every post. End-to-end tests
that look for other members' posts on Home now open Latest by name.

## Consequences

- A post's place in Discover can be worked out by hand from public numbers.
  That also makes it easier to game with coordinated replies and reposts. A
  member counts once per conversation, authors are spread out and reported posts
  wait, which limits it, and moderators see the same numbers.
- Popular posts reach further than they do in Latest. That is the point, and why
  reported posts wait.
- Without a record of what a member has seen, Discover shows the same posts
  again on the next visit until they age out or are overtaken.
- Nothing new is stored, so the data export does not change.

## Not done

- "Show fewer like this": it would need a stored choice per member and post,
  included in the data export. Add it if members ask.
- Skipping posts a member has already seen. Recording reads is a privacy change
  of its own.
- Other sources: people followed by the people you follow, hashtags, a mix of
  communities within a page.
- A learned model. Not before there are far more members, and then only as a
  separate service behind the same interface, with its rules still published.
- The numbers here (72 hours, the points, 1.5, the halving, 100 posts, two
  reports, 2,000 replies) are starting values. Changing one amends this ADR, and
  the rules page shows the new numbers.
