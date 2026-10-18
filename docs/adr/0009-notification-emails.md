# ADR 0009 — Notification emails are grouped, decided when they are sent, and say little

**Date:** 18 October 2026 · **Status:** Accepted

## Decision

A member's notifications are also **emailed** while the email switch in Settings
(**Email me my notifications**, `members.email_notifications`) is on. What notifies
a member at all is unchanged: the per-kind choices (migration 0018)
still decide that, so a kind switched off sends neither a notification nor an
email. Replies, likes, reposts, quotes, mentions, follows and every moderation
notice can be emailed.

- **Default.** Members who join from now on start **on**; everyone who was already
  a member when this shipped starts **off** (migration 0021). They signed up when
  notifications lived in the app, and were never asked. Mail to people who did not
  expect it is how a sending domain gets marked as spam, and sign-in codes are sent
  from the same domain, so a bad week for notification mail could stop people
  signing in. They can turn it on in Settings; flipping the default for existing
  members is one `UPDATE` if that is wanted later.
- **Moderation notices** cannot be turned off one by one (they never could), so the
  per-kind choices never stop them. The email switch does: a member who has turned
  email off, or followed its unsubscribe link, gets no email of any kind, and is
  still told in the app. That is the promise the switch makes.
- **One email, not thirty.** A notification waits **5 minutes** (`EMAIL_DIGEST_DELAY_S`)
  from the oldest one waiting, so what follows it joins it, and a member is emailed
  **at most every 30 minutes** (`EMAIL_DIGEST_GAP_S`). Everything waiting goes in one
  email; likes of the same post, reposts and follows are rolled into one line each
  ("@a, @b and 28 others liked your post"), and at most eight lines are written out,
  with the rest counted.
- **Every email** has a one-click unsubscribe link in the body and in the
  `List-Unsubscribe` and `List-Unsubscribe-Post` headers (RFC 8058), says why it was
  sent and links to Settings. Unsubscribing turns the email switch off and changes
  nothing else.

## What an email says

Written to survive a lock screen and a shared inbox. The subject never quotes a post.
A reply, quote or mention shows the first 80 characters of that post, and a like or
repost the start of the member's own post, and only for things the member could still
see in the app: nothing from a blocked, muted or suspended member, a deleted or
removed post, or a like that was taken back. A moderator's decision is stated in
general words ("A moderator removed one of your posts") with no post text and no
reason; the details are in the app. Members' words are escaped in the HTML part. All
posts are public today; if private posts arrive, what an email quotes must be looked
at again.

## How

- **A notification never waits on email.** `notify` and the code around it are
  unchanged and do not know email exists. `notifications.email_settled_at` marks a
  notification the email side has dealt with: sent, or passed over (migration 0021
  settled everything before it).
- **Decided at the moment of sending.** A BullMQ job (`apps/api/src/email/email-queue.ts`,
  in the API process like the media and link workers) runs `sweep` every minute: it
  settles what no email will be sent for (read in the app already, a member who has
  email off or is suspended, older than a day), then queues one `digest` job per
  member whose oldest waiting notification is old enough. The digest job reads what is
  true then: it leaves out what the member has since read, opted out of, blocked or
  muted, and what has been taken down, using the same rules as the notification list.
  If nothing is left it sends nothing.
- **Failures.** The digest job is retried five times with a growing delay. A message the
  mail server refuses for good (a 5xx other than a login problem) is given up on.
  After the last retry the failed job stays for an hour, which keeps that member from
  being queued again meanwhile. Notifications over a day old are never emailed. A
  failure never reaches the notification or the post: they are written without a
  line of email code.
- **The address stays in Kratos.** It is asked of Kratos's admin API
  (`KRATOS_ADMIN_URL`, private network only) when an email is about to be sent, never
  copied into our tables, and only if the member has confirmed it.
- **Transport.** SMTP through `nodemailer`, with the `SMTP_CONNECTION_URI`,
  `SMTP_FROM_ADDRESS` and `SMTP_FROM_NAME` that Kratos already uses (Resend in staging
  and production, Mailpit on `127.0.0.1:1026` locally). Without `SMTP_CONNECTION_URI`
  no email is sent and the worker does not start.
- **The link.** `HMAC-SHA256` over the member's ID, with a key derived (HKDF) from
  `KRATOS_WEBHOOK_SECRET` for this one purpose, so no new secret has to reach every
  server first. It does not expire: an email is read months later and the worst a
  copied link can do is turn one member's email off. The body link
  (`GET /api/v1/email/unsubscribe/<token>`) acts at once and lands on `/email-off`;
  mail programs `POST` to the same address.

## Costs

- A `GET` that changes something means a mail scanner that opens links can
  unsubscribe someone. It is undone in Settings, and a confirmation page would not be
  one click.
- Delivery is at-least-once: a crash between sending and settling sends the same email
  twice. Rare, and harmless.
- A link cannot be revoked for one member; changing `KRATOS_WEBHOOK_SECRET` ends all of
  them.

## Not done

- Choosing email per kind, or how often. The kinds decide notifications, and email
  follows.
- Push notifications.
- A resubscribe link. Turning email back on is in Settings.
