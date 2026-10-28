# ADR 0015 — The ideas board: ideas and problem reports as posts, with votes and statuses

**Date:** 28 October 2026 · **Status:** Accepted, built 28 October 2026 (GitHub
sync not built) · **Roadmap:** `member-ideas`

## Decision

Members suggest ideas for HeyNaija and report problems with it on a board,
`/ideas`. Each one is an ordinary post in Building HeyNaija, whose first line is
its title, plus a row in `ideas` with its kind, title and status. Members vote
for the ones that matter to them; Building HeyNaija's moderators move each one
along, and everyone involved is told.

- **Kinds:** idea or problem.
- **Statuses:** under review, planned, in progress, shipped, not now, duplicate.
  Under review, planned and in progress are open. Not now and duplicate need a
  reason, which everyone sees; a duplicate names its original, and its votes move
  there. Any status can carry a public note.
- **Votes:** one per member, separate from likes, counted when read from active
  members only. Closed ideas take no new votes; a vote can always be taken back.
  The author's own vote is added when they send it.
- **The board:** open, shipped or closed; ideas, problems or both; by votes or
  newest. While a title is typed, ideas with words like it are shown, so the
  same one is voted for rather than sent twice.
- **Problem reports** also keep the page they were reported from, the browser's
  description of itself and the running release (`RELEASE`). Only the reporter
  and the board's moderators see those (`problem_details`); the report itself is
  a public post.
- **Who decides:** Building HeyNaija's moderators, and site-wide moderators, set
  statuses on the idea's page. Each change is on the idea's timeline
  (`idea_status_changes`, with who made it) and notifies the author and everyone
  who voted, except the moderator who made it (`idea_status`).

## Why

- A post keeps the board inside HeyNaija's existing rules: it is public, it can
  be replied to, reported, taken down and appealed like any other, and it is in
  the data export. Nothing new to moderate.
- Building HeyNaija is where the people building the app already work in the
  open, and its rules already welcome feedback and bug reports. Posting an idea
  there does not require joining it: the board is for every member.
- Posts have no title, but finding a similar idea while typing needs one. The
  title is the post's first line, so the post reads naturally in feeds, and is
  stored on the idea for the board and the search.
- Votes are separate from likes so that liking a well-put post does not count as
  wanting the feature, and so that a duplicate's votes can move.
- The page, browser and version help fix a problem but are not something a
  member should have to publish. They stay private.
- Notifications about status are always sent, like moderation notices: they are
  the board's answer to something the member sent or asked for.

## How

- Tables (migration 0027): `ideas` (one per post, checks on kind, status, and
  that only a duplicate has an original), `idea_votes`, `idea_status_changes`
  (the first row is the sending), `problem_details`.
- API: `GET /v1/ideas`, `GET /v1/ideas/similar?q=`, `GET /v1/ideas/:id`,
  `POST /v1/ideas` (counts toward the posting limit), `PUT`/`DELETE
  /v1/ideas/:id/vote`, `PUT /v1/ideas/:id/status`. `PostsService.create` gained
  `anyMember` and `alongside`, so the post and its idea are written in one
  transaction.
- Similar ideas: each word of three or more letters or digits as a prefix, any
  of them, over the title and post text, ranked by `ts_rank`. Only letters and
  digits reach the query.
- Web: `/ideas`, `/ideas/new` (`?kind=problem&from=…`), and a panel above the post
  on `/p/:id` with votes, status, timeline, the private details where allowed
  and, for moderators, the status form. The account menu has "Ideas and
  problems" and "Report a problem", which carries the page the member is on.
- Notifications, email digests and push messages say "Your idea is now
  planned", "A problem you voted for is now shipped", quoting the post.
- The data export (format 10) lists the ideas a member sent, with their problem
  details, and their votes.
- The end-to-end, demo and load-test clean-ups remove idea rows before the posts
  they belong to.

## Not done

- A GitHub App that opens an issue when an idea is planned, and a webhook that
  brings status back (assigned, closed, live after a production deploy).
  Replies would not be synced, so members' words are not copied to GitHub.
- Turning status notifications off in Settings.
- Votes are counted when read. Fine at the pilot's size; a stored counter, like
  `like_count`, if the board grows long.
- Carrying the governance feedback channel (`governance-feedback`).
