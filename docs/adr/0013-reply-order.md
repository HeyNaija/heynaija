# ADR 0013 — Replies: the author's first, then everyone else's, newest first

**Date:** 25 October 2026 · **Status:** Accepted · **Amends:** the reply order in
[docs/design/threaded-conversations.md](../design/threaded-conversations.md)

## Decision

Every list of replies — under the post in focus, and under each reply when its
branch is opened — is in two groups:

1. replies by the author of the post they answer, then
2. everyone else's.

Each group is in time order, **newest first** by default. A switch above the
replies reads them **oldest first** instead (`/p/<id>?replies=oldest`); the choice
holds for every branch on that page, and is not saved. Nothing is ranked by
likes, reposts, reach, who the reader follows or anything paid for.

The page says so where the replies start: "@ade's own replies come first, then
everyone else's, newest first. Under each reply, its author's replies come first
the same way. Nothing is ranked by likes or reach."

## Why

- Replies were oldest first only. On a busy post the newest replies were pages
  down, and an author answering questions or continuing their thread was mixed in
  with everyone else.
- X ranks replies by default ("Most relevant"): its help centre says it
  considers whether the post's author replied, whether the reader follows the
  person replying, and whether they pay for X Premium. Readers can switch to
  "Most recent" (newest first) or "Most liked". It has no oldest-first order.
- HeyNaija's charter promises "Feeds in time order", with nothing ranked by what
  keeps you scrolling, and the feeds say "Newest first, not ranked". Taking X's
  author-first rule and its "Most recent" order keeps that promise: both are
  plain rules that are the same for every reader and can be stated in a
  sentence. Relevance, follows-first and paid placement are left out. So is
  "Most liked", which would make likes decide what is read.
- Under a reply, "the author" is that reply's author: someone answering the
  replies to what they said is the conversation continuing, as it is for the
  post's author at the top.

## How

- `GET /v1/posts/:id` and `GET /v1/posts/:id/replies` take `order=newest`
  (the default) or `order=oldest`. `PostsService.replyPage` reads each group as
  its own index-ordered query of at most a page on
  `(reply_parent_id, created_at, id)`, then takes the page from the two, so a
  page never sorts all of a busy post's replies.
- A deleted or taken-down reply by the author that is still shown (as "This post
  is no longer available", because replies under it survive) goes among
  everyone else's, so its place does not say whose it was.
- Reply cursors are version 2: `[2, parentId, order, group, timestamp, id]`. A
  cursor is refused for another parent or another order. Version 1 cursors, from
  pages open when this was deployed, are refused; "Try again" or a reload
  starts the list afresh.
- In the browser a just-posted reply goes where the server will put it: first in
  its group when newest first, last when oldest first, or in the separate
  "Your reply" spot while the rows before it are not loaded yet. Rows carry
  `lead` (by the parent's author) to tell which group.

## Not done

- The author's replies are found by filtering the parent's children by author.
  On a post with many thousands of replies and few by its author this reads past
  everyone else's; an index on `(reply_parent_id, author_id, created_at, id)`
  would make it a seek. Measure with the load-test kit before adding it.
- No "Most liked" or other ranked order.
