# ADR 0027 — Weekly highlights: a few conversations for a member who has been away, chosen by published rules

**Date:** 13 November 2026 · **Status:** Proposed · **Roadmap:** `weekly-highlights` ·
**Related:** [ADR 0009](0009-notification-emails.md), [ADR 0011](0011-push-notifications.md),
[ADR 0014](0014-discover-and-top-replies.md), [ADR 0023](0023-app-push.md)

## Decision

Once a week, a member who has not opened HeyNaija for a few days is sent **a few
conversations they missed**, each saying why it was chosen. It goes out as a push
notification where they have push on, otherwise as an email where they have
email on. It is behind the `weeklyHighlights` flag, off in production until the
owner turns it on.

- **Who.** An active member with **Send me weekly highlights** on
  (`members.weekly_highlights`, on by default), last seen at least **3 days**
  ago (`awayDays`) and at most **8 weeks** ago (`stopAfterDays`). A member who
  was here this week is sent nothing: they have seen it. Someone gone two
  months has left, and is not chased; it also keeps mail to dead inboxes from
  hurting the domain the sign-in codes are sent from.
- **When.** The week's run opens on **Sunday at 17:00 UTC**, 6pm in Nigeria
  (`HIGHLIGHTS_WEEKDAY`, `HIGHLIGHTS_HOUR_UTC`), and stays open **24 hours**, so
  a server that was away at the hour still sends. A run deals with a member
  once, whether or not anything went out (`members.highlights_settled_at`).
- **What.** Up to **5** top-level posts (`maxPosts`) from the last **7 days**
  that were written **after the member was last here**, so nothing in it is
  something they have already seen. With fewer than **2** worth sending
  (`minPosts`), nothing is sent that week.
- **Worth sending** means someone other than the author replied, quoted, liked
  or reposted it, or the member follows its author. A post nobody reacted to,
  by someone the member does not follow, is not a highlight.
- **Order.** By points, most first, newer first on a tie, each author once with
  their best post. The points are Discover's (ADR 0014): 2 for each member who
  replied anywhere in the conversation or quoted it, 1 for each like and each
  repost, 3 more for each person the member follows among them, 2 if they
  follow the author, 1 if it is in a community they joined. There is **no
  ageing**: this is the week, not this hour, and Discover's decay would bury
  Monday's best conversation by Sunday.
- **Left out** is what Discover leaves out: the member's own posts, anyone they
  blocked or muted (or who blocked them), suspended members, posts deleted or
  taken down, posts marked sensitive, posts held by reports, replies on their
  own, Gist replies, and a minor's posts to someone the minor does not follow
  (ADR 0020).
- **Each one says why**, in Discover's words, the first that is true: "@ade, who
  you follow, replied", "You follow @ade", "From Lagos, which you joined",
  "Active on HeyNaija". Beside it, the counts anyone can see: "4 people in the
  conversation · 12 likes".
- **One channel, push first.** If any of the member's browsers or apps takes a
  push, that is all they get: one notification, "While you were away on
  HeyNaija", with the first conversation and how many more there are, opening
  that conversation. Otherwise an email, if `members.email_notifications` is on.
  With neither, nothing is sent. So nobody is reached on a channel they have
  not accepted: a member who joined before email existed and never turned it on
  (migration 0021) gets no email from this either.
- **Its own switch, and its own link.** Settings → Notifications has **Send me
  weekly highlights**. The email's unsubscribe link (and its RFC 8058
  `List-Unsubscribe` header) turns highlights off and nothing else, without
  signing in; it lands on `/email-off?what=highlights`. The link in a
  notification email still turns all email off, which stops highlights by email
  too. A link for one is not a link for the other
  (`unsubscribeToken(key, id, 'highlights')`).
- **Not a notification.** Nothing is written to `notifications`, the bell does
  not count it, and the per-kind choices do not apply.
- **The rules are published** at `/about/highlights`, with the numbers read from
  the API (`GET /v1/highlights/rules`), and a notice while the flag is not on
  for everyone. Changing a number in `HIGHLIGHTS_RULES` changes the page.

## Why

- Every notification HeyNaija sends is a reaction to something the member did:
  a reply, a like, a follow. A member who only reads is never told anything,
  so nothing brings them back. PLAN.md §9 asks that 25% of activated members
  return within 7 days; most members of any network read more than they post.
- It has to fit what HeyNaija promises. So: rules anyone can read, a reason on
  every conversation, only public activity plus the member's own follows and
  communities, nothing learned from what they read, and no streaks or "we miss
  you" messages. It is sent only when there is something to show, and stops by
  itself when someone has plainly left.
- "Written after you were last here" is the one new input: `last_seen_at`,
  which the API already keeps. It makes the promise "nothing you have already
  seen" true without recording what anyone reads.
- Push before email, never both, is ADR 0011's rule for notifications, and for
  the same reason: one thing should not buzz twice.
- A separate switch, because a member may want replies emailed and no
  roundup, or the other way round. On by default, because an opt-in nobody
  finds would reach no one who has gone quiet, which is the whole audience;
  the first message carries the way to stop it.

## How

- **Tables** (migration `0045_weekly_highlights`): `members.weekly_highlights`
  (boolean, default true), `members.highlights_settled_at` (when a run last
  dealt with them) and `members.highlights_sent_at` (when any were last sent).
- **Code** in `apps/api/src/highlights/`: `rules.ts` (the numbers, and
  `openRun`, which says whether a run is open), `highlights.service.ts`
  (`sweep`, `send`, `pick`), `highlights-email.ts` (the email and the push
  message), `highlights-queue.ts` (a BullMQ queue, `highlights`, in the API
  process like the email and push workers), `highlights.controller.ts` (the
  rules and the unsubscribe routes).
- **Sweep**, every 5 minutes (`HIGHLIGHTS_SWEEP_EVERY_S`): while a run is open,
  queues up to 500 members it has not dealt with. A member the flag is off for
  is marked dealt with, so a flag on for a short list does not rescan everyone.
- **Send**, one job per member (`highlights-<id>`, four tries): checks again
  that they are due, picks, and sends. Everything is decided from what is true
  at that moment, as for email and push. A push service that cannot be reached
  falls back to email; if there is no email to fall back to, the job is retried.
- **Push** goes through `PushNotificationsService.sendTo`, which reuses the
  places, sealing and clean-up of notification pushes (ADR 0011, 0023, 0026).
  The apps show it like any other: a title, a body, a path and a tag.
- **Preferences.** `GET /v1/notifications/preferences` carries `highlights`
  only while the flag is on for the member, so Settings and the apps show no
  switch for something that does not exist yet; `PUT` takes `highlights`.
- **Data export** (format 15): `weeklyHighlights` and
  `weeklyHighlightsLastSent`. Erasing an account clears all three columns.

## Judging it

No opens or clicks are tracked: the email has no pictures and its links are
plain. Whether highlights work is read from two times the database already
has, when they were sent and when the member was next seen:

```sql
select count(*) filter (where highlights_sent_at > now() - interval '7 days') as sent,
       count(*) filter (where highlights_sent_at > now() - interval '7 days'
                         and last_seen_at > highlights_sent_at) as came_back
from members;
```

If few come back, the rules or the feature should change. `/privacy` and
`/about/highlights` say that this is kept and why.

## Costs

- One ranking query per member per week, of the same shape as Discover's.
  Fine at pilot scale; at 20,000 members it is 40 sweeps, a little over three
  hours of the 24 the run is open. Not yet measured on the load-test seed.
- A member with push on a browser they no longer use is counted as reached and
  gets no email. The same is true of notifications (ADR 0011).
- Everyone gets it at the same hour, Nigerian evening. Members abroad get it
  at whatever hour that is for them; no time zone is stored.

## Not done

- The apps have no switch for it yet (`heynaija-mobile`, Settings). Until they
  do, a member reached by push in the app turns it off on the web. **Do not turn
  the flag on in production for everyone before that ships.**
- No page in the app lists the week's highlights; the push opens the first
  conversation, and Discover shows what is active now.
- Sending at each member's own evening, and a member choosing the day.
- Communities' moderators choosing what leads their community's highlights.
