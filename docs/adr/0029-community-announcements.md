# ADR 0029 — Community announcements: a moderator notifies every member, once a day

**Date:** 13 November 2026 · **Status:** Proposed · **Roadmap:** `community-announcements` ·
**Related:** [ADR 0009](0009-notification-emails.md), [ADR 0011](0011-push-notifications.md),
[ADR 0020](0020-under-18-accounts-and-adult-labels.md), [ADR 0023](0023-app-push.md),
[ADR 0024](0024-stories.md)

## Decision

A community's moderator can post **an announcement**: a new post in the
community that every member is told about, in the app, by push and by email,
like any other notification. A community sends at most **one a day**, and every
member can turn them off, for one community or altogether. It is behind the
`communityAnnouncements` flag, off in production until the owner turns it on.

- **A switch, not a word in the post.** The composer shows **Notify all
  members** to someone who may use it, and the button then reads **Post and
  notify**. There is no `@everyone` to type: a member cannot write it by
  accident or try it, and an ordinary post never notifies a whole community.
- **Who.** A moderator of that community, or a site moderator who has joined it
  (`mayAnnounce`). The same people who pin its posts, except that a site
  moderator has to be a member, since an announcement speaks for the community.
- **What.** A new top-level post in the community. Not a reply, not an update
  to a story (its followers are told already), not a Gist reply, not a post to
  everyone.
- **Once a day, per community** (`ANNOUNCEMENT_EVERY_H`, 24 hours), whichever
  moderator sends it. Five moderators do not make five a day. The composer says
  when the day's one has gone and roughly when the next can go, and the post
  can still be made as an ordinary one. Facebook Groups limits `@everyone` the
  same way. X Communities, the nearest thing to ours, never had it and was
  closed for spam; this limit is the reason we can.
- **Who is told.** Every active member of the community except the author, who
  has not turned announcements off. Someone the post also mentions or quotes is
  told that instead, once.
- **Two ways to turn it off.** The bell beside **Joined** on the community's
  page turns off that community's (`community_memberships.announcements`).
  Settings → Notifications has a box for all of them (`community_announcement`
  is one of the kinds a member may turn off). Both are on until turned off.
- **Shown only while it still applies**, as everything else is decided when it
  is read (`visible`): the post is up, the moderator is active and neither
  blocked nor muted by the reader, the reader is still a member and has the
  community's announcements on. So leaving or turning them off also stops a
  push or email that had not gone yet. A post marked sensitive, or in a
  community marked sensitive, reaches adults only (ADR 0020).
- **Under-18s** who joined a community are told of its announcements. A mention
  from a stranger is kept from a minor because it singles them out; an
  announcement goes to everyone in a place they chose to join, and they have
  the same two switches.

## How it works

- **Posting.** `POST /v1/posts` takes `announce: true` with `community`.
  Refused with `feature_unavailable` (the flag), `not_a_moderator` (403),
  `announcement_too_soon` (400, with `nextAt`) and `not_an_announcement`. A
  refused announcement posts nothing.
- **The day's one** is `communities.announced_at`. Inside the post's
  transaction, one `UPDATE … WHERE` takes it or finds it taken, so two
  moderators sending at once get one through, and a post that fails further
  down (a picture not ready) gives it back.
- **Telling members** is one `INSERT … SELECT` over the community's members in
  the same transaction (`notifyCommunity`), after the mentions, so nobody is
  told twice. Push and email then pick the rows up as they do every
  notification: the push sweep takes 500 members a pass, and anything not
  pushed within ten minutes is left to email and the app (ADR 0011).
- **Words.** "@ada posted an announcement in Lagos", with a short piece of the
  post, in the app, in a push and in the email. One push per post
  (`community_announcement:<post>`).
- **Communities** say three things to a signed-in viewer, in the list and on
  the page: `viewerCanAnnounce`, `nextAnnouncementAt` (only to someone who may)
  and `viewerGetsAnnouncements` (null for a non-member). All three say "no"
  while the flag is off for the viewer, so the web and the apps show nothing
  for a feature that is not there, with no flag of their own to read. The
  one place that reads the flag is the box in Settings, left out while it is off.
- **A member's switch.** `PUT` and `DELETE /v1/communities/:slug/announcements`.
  Turning them off works whatever the flag says.
- **Data export** (format 20): each community you joined says whether its
  announcements are on.
- **Migration 0052** adds the two columns and the new kind to the check on
  `notification_opt_outs`. It notifies nobody.

## Costs

- One announcement writes a notification row per member. At the size of a
  community today that is nothing; at 50,000 members it is one insert of 50,000
  narrow rows inside the post's transaction, a second or two, once a day. If a
  community grows past that, the insert moves to a job.
- Email: a member without push gets an email for each community that announces
  that day, grouped with their other notifications (ADR 0009). The daily limit
  is what keeps this from being bulk mail; if it proves too much, announcements
  can be left out of email without touching the app or push.
- Nothing on a post says it was an announcement. The members who were told
  have the notification; a later reader sees an ordinary post.
