# ADR 0024 — Stories: one author's updates to a post, in order, shown once in feeds

**Date:** 7 November 2026 · **Status:** Proposed · **Roadmap:** `stories`

## Decision

A **story** is a post plus the updates its author adds to it later, in order.
It is for anything that unfolds: building HeyNaija in public, a move, a court
case, a match, a trip.

- **Starting one:** any of your own top-level posts becomes a story when you add
  its first update, with **Add update** in the post's menu. There is nothing to
  choose when posting. Only the author adds updates.
- **An update is a post of its own.** It is written in the same composer and
  follows the same rules on length, pictures, video, polls, link previews,
  labels, reports and moderation. It answers no one, so it is not a reply.
- **Replies go under the update they are about**, in the usual branches. Nobody
  replies "at the end": the end of a story is the author's next update.
- **In feeds a story shows once**, as its newest update, at the time of that
  update. Above the update, a one-line box of the first post is joined to it by
  a short line in the gap, and the card says "Story · 7 updates". The first post
  and the older updates step out of Latest, Following, Discover, communities,
  trending and the profile's Posts tab. If the newest update is deleted or
  taken down, the one before it takes its place. A hashtag's page still lists
  every post that uses it, updates included, because it is a search for words.
- **The story page** is the first post's page, `/p/<id>`. It shows the first
  post, "Story · 7 updates · 23 following" and **Follow story**, then the
  updates oldest first. A line in the gutter joins them and curves into each
  update's card. With more than four updates, the middle ones fold: the page
  shows the first post, "Updates 1 to 4" folded, then the newest three. Each
  update shows its reply count; its replies are on its own page. The first
  post's own replies come after the updates, as on any post. At the end of the
  spine the author has a box, "Add update 8…", in which the next update is
  written where it will go, as a reply is written under its post. It is not
  a quote: the story is right above it, so it needs no card of the first post.
- **An update's own page**, `/p/<id>`, is its conversation, as for any post,
  with the first post as a box above it and "Update 6 of 7 · Read the story".
- **Following a story** is a choice made with **Follow story**. It has nothing
  to do with following the person. Followers are told about each new update
  (`story_update`), in the app, by push and by email, like other notifications,
  and Settings can turn it off. The number of followers is public; who they are
  is not, as with likes.
- **Updates are numbered by their place** among the story's live updates when
  read, so deleting one does not leave a gap.

### The name

"Story", after "post", "reply" and "thread": a plain word for what it holds.
"Thread" was ruled out, because every reply conversation here is already a
thread (in the code and on screen), and Meta has an app called Threads.
"Tori", Pidgin for a story or news, was liked but set aside for a word in the
same register as the rest.

Instagram, Facebook and WhatsApp use "stories" for posts that vanish after a
day. HeyNaija's stories do not vanish. The card always says how many updates
there are, and avatars get no ring, so nothing on screen suggests they are gone
by tomorrow.

## Why

- An author following something up has had two choices. A new post loses
  what came before. A reply to their own post is never seen by their
  followers: feeds list top-level posts only (`topLevel` in
  `apps/api/src/posts/posts.service.ts`), and a reply notifies only the person
  it answers. [ADR 0013](0013-reply-order.md) puts the author's own replies
  first, but only for someone who opens the post again.
- The first idea, from a member building HeyNaija in Building HeyNaija, was a
  post whose replies form one straight chain, where anyone can reply only to
  the latest. Letting everyone extend the chain mixes the author's updates
  with "when launch?". Two people replying at the same moment both think they
  answered the latest. And nobody can answer an earlier update. Slack threads
  manage with one flat list because a small team reads them; a public post is
  read by strangers. Keeping the author's updates as the spine, and everyone
  else's replies off to the side, keeps the story easy to follow however busy
  the replies get.
- X makes a thread out of an author's replies to themselves, joined by a line,
  and lets them add to it later
  ([help](https://help.x.com/en/using-x/create-a-thread)). Here, replies to
  yourself stay replies. A story is its own thing, so it can leave the reply
  machinery alone.
- Making an update a post, not a reply, keeps everything built on replies as it
  is. Reply counts still count other people's direct replies, branches still
  hold one conversation each, and reply notifications are unchanged. Each
  update gets a conversation of its own. Feeds, Discover, moderation, reports,
  the data export and account deletion already handle posts.
- Showing a story once, at its newest update, keeps the feeds' promise:
  newest first, not ranked. The update really is new, and nothing moves for
  any other reason. A story with twenty updates would otherwise fill a page.
  The rule fits in one sentence, and the feed's note can say it.
- Following a story is separate from following a person, so you can follow
  one story without everything else they post. Following a person sends no
  notifications today, so following a story should not be implied by it.
- Only the author adds updates. That is simplest, and the hardest to abuse.
  Co-authors can come later, if people ask for them.

## How

- **Tables** (migration `0040_stories`):
  - `posts.story_id`: on an update, its story's first post. Null on everything
    else.
  - `posts.story_updates`: on a first post, how many live updates it has.
  - `posts.superseded`: true for a story's first post while it has a live
    update, and for every update except the newest. Feeds leave these out.
  - `posts_story_created_idx` on `(story_id, created_at, id)` where `story_id`
    is not null.
  - `story_follows (story_id, member_id, created_at)`, one row per follower.
- **Kept by a trigger**, as the counters are (migration 0011).
  `story_updates` and `superseded` are worked out again whenever an update is
  added, deleted, taken down, hidden or restored. Every path that changes a
  post (the author, moderation, a Gist's host) then keeps them right in the
  same transaction.
- **Feeds:** `topLevel` gains `not superseded`, and so do the copies written
  out in SQL (Following's entries, Discover, trending). A repost still brings
  in the post that was reposted, superseded or not, because a repost is a
  choice someone made.
- **API:**
  - `POST /v1/posts` takes `storyOf`, the first post's id. It must be the
    caller's own live top-level post, not itself an update, and not in a Gist.
    The update takes the first post's community, and its reply audience starts
    as the first post's. It counts toward the posting limit.
  - Every post carries `story`, or null:
    `{ id, number, updates, followers, following, start }`. `number` is 0 on
    the first post. On an update, `start` is the first post in the shape a
    quoted post has, for the box above it in feeds. That shape already covers a
    post that is gone or that the reader cannot see.
  - `GET /v1/posts/:id` on a first post also returns `updates`: all of them up
    to four, otherwise the newest three, oldest first. `GET
    /v1/posts/:id/updates` pages every update oldest first, for unfolding the
    rest, with exact-time keyset cursors.
  - `PUT` and `DELETE /v1/posts/:id/story-follow`.
- **Notifications:** a new kind, `story_update`, added to
  `OPTIONAL_NOTIFICATION_KINDS`. Posting an update writes one row per follower
  in the same transaction (actor: the author; post: the update). Blocks, mutes
  and deletions are applied when it is read, as for every kind. Email and push
  say "@psami added to their story" and quote its start.
- **Web:** the author's box at the end of the spine is the reply box, posting
  with `storyOf`. Add update in a post's menu goes to it (`/p/<story>#add-update`)
  and puts the cursor in it; on a post that is not a story yet it opens the
  post with the box under it (`?add=update`) and a line saying it will become
  one. The feed card is the update's card
  with the first post's box and line above it. The story page's spine uses the
  curved reply lines (branch `style/curved-thread-lines`). The feed note says
  "A story shows once, at its newest update."
- **Mobile** (`HeyNaija/heynaija-mobile`), on the same API: the feed card, the
  story screen with its curved spine, Follow story, and the notification row.
  The spine ends in "Add update 8…", which opens the sheet replies are written
  in over the story, headed by its first post and "Update 8 of your story";
  Add update in a post's menu opens the story and that sheet.
- **Data export** (format 14): the stories you follow. Your updates are already
  in it as posts, now with `storyId`.
- **Account deletion:** a member's `story_follows` rows go with them, as their
  follows do.

## Not done

- **Replies in place on the story page:** an update's replies open on its own
  page for now.
- **Co-authors.**
- **Rearranging:** reordering updates, moving one to another story, or turning
  a reply, or an earlier post, into an update.
- **Large stories:** notifications are written one row per follower when the
  update is posted. That is fine for the pilot. A story with thousands of
  followers should hand them to a background job.
- **Catching up:** the card shows the newest update only. A "3 new since you
  last looked" line would need to record what each member has read, which
  HeyNaija does not do.
- **Stories in Gists.**
