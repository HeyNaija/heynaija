# ADR 0007 — Reposts move a post up a chronological feed, once; quotes are posts

**Date:** 16 October 2026 · **Status:** Accepted

## Decision

A **repost** shares someone's post, unchanged, with the reposter's followers. A
**quote** is an ordinary post with its own text that shows another post inside it.

Feeds stay newest first and unranked. A repost puts the post into the Following
feed of the reposter's followers, and onto the reposter's profile (Posts tab), at
the time of the repost. **Each post appears at most once in a list**, at the latest
moment it entered that list: when it was posted (if the list would show it
anyway), or when someone the reader sees reposted it. The card says which:
"@x reposted", or "You reposted".

Latest, community feeds, search and trending have no reposts. Quotes, being
posts, appear wherever posts do.

## Why

- The feeds promise "Newest first, not ranked" and say why each post is there.
  The moment a repost happens is a plain, explainable time to sort by, and the
  reason line can name the reposter.
- Showing a post once, rather than once per repost, keeps a popular post from
  filling a follower's feed when several people they follow share it. It also
  keeps pagination simple: every entry is one post, so the cursor is the entry's
  time and the post's ID, and no post repeats across pages.
- A quote has its own words, replies and likes, so it behaves like any other post.

## How

- `reposts(member_id, post_id, created_at)`, one row per member and post.
  Reposting again keeps the first repost; undoing and reposting again moves the
  post back up.
- `posts.repost_count` counts reposts by active members, kept by triggers like the
  like and reply counts (migration 0015). Quotes are not counted in it.
- `posts.quote_post_id` points at the quoted post, with no foreign key (like
  `reply_parent_id`).
- `PostsService.entries` builds Following and the profile Posts tab: own,
  followed and community posts plus visible reposts, keeping for each post only
  its latest way in. Each branch is cut to one page before they are merged. It
  first reads the members the reader can see (themselves and who they follow, or
  the profile's owner) and their communities, and passes them to the main query
  as arrays, so Postgres plans for that reader: reading each account's posts and
  reposts for someone who follows a few, or walking the newest site-wide
  (`reposts_created_idx`, migration 0016) for someone who follows many.
  Subqueries in their place made every Following page read every repost on the
  site ([load testing](../loadtest.md), item 5).
- Visibility is decided on read, as for everything else:
  - Blocks (either way) and mutes apply to the reposter and to the original author.
  - A repost by someone the reader cannot see doesn't count, so the post falls
    back to its next way in, if any. On a member's own profile, their reposts show
    even if the reader muted them, as their posts do.
  - Reposts of a deleted or taken-down post disappear. They come back if a
    moderator restores it.
  - A quoted post the reader cannot see (deleted, taken down, author inactive,
    blocked or muted) becomes one placeholder, "This post is no longer
    available", which does not say why.
- Notifications: `repost` (once per member and post, hidden once undone) and
  `quote` (the quote itself; a reply that quotes its own parent notifies once,
  as a reply).

## Consequences

- When a post is reposted again by someone the reader follows, it moves above
  posts they may already have scrolled past. Pages already loaded do not change
  until the reader refreshes.
- Liking or replying from a reposted card acts on the original post, as expected.
  Nothing records which repost led someone to it.
- The data export (format 3) lists the member's reposts and marks their quote
  posts with `quoteOf`.
- Nothing lists the quotes of a post yet. `posts_quote_idx` is there for when
  something does.
