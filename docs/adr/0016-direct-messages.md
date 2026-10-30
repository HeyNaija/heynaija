# ADR 0016 — Direct messages: opt-in, for age-verified adults only, with message requests

**Date:** 30 October 2026 · **Status:** Proposed, design only. Nothing is built:
no schema, no migration, no endpoint, no UI. · **Roadmap:** `direct-messages`
(blocked on `minor-safeguards` and `age-verification`) · **UI spec:**
`apps/web/DESIGN.md`, "Direct messages" · **Related:**
[ADR 0006](0006-age-status-model.md), [ADR 0009](0009-notification-emails.md),
[ADR 0011](0011-push-notifications.md), `docs/governance/under-18-rollout.md`
section 5

## Decision

Members can send private one-to-one text messages, X-style: an inbox of
conversations, message requests from people the recipient does not follow, and
block, report and mute inside every thread. Version 1 is text only, 1:1 only.

**Owner decision (30 October 2026): DMs are opt-in, and only for members who are
18 or over and have completed age verification.** A member who is unverified,
under 18 or of unknown age can neither send nor receive DMs and cannot be
contacted: no inbox, no Message button on their profile, not in the recipient
search. A verified adult must also turn DMs on in Settings (default off). Both
sides of every conversation must be verified and opted in. The feature ships
dark as well: off by default in every environment.

The recommendation in each section below is what this ADR proposes; the open
questions (end of file) need the owner or governance before building.

## Context

- Today there are no direct messages, and accounts are 18+ only (ADR 0006,
  `UNDER_18_ACCOUNTS_ENABLED` locked off).
- **The existing age mechanism is not strong enough yet.** `restricted.age_assurances`
  and `ageStatus()` (`apps/api/src/governance/age.ts`) rank statements as
  `declared` (the "I am 18 or older" box at signup), `reviewed` (a moderator) and
  `verified` (`identity_provider` or `age_assurance_provider`). "Age-verified"
  here means assurance `verified`. Today **no member can have it**: the NIN
  provider is locked off (`NIN_VERIFICATION_ENABLED`) and no age-assurance
  provider is chosen or built (rollout doc section 2, which also says that
  provider must not require a NIN). Every adult is `declared` at best. So the
  gate is correct to build on, but DMs cannot be switched on for anyone until an
  age check exists. That is a new roadmap dependency, `age-verification`.
- Messages are the first private content on HeyNaija. ADR 0009 notes that
  email wording "must be looked at again" when private content arrives; this is
  that point.
- Phones are low-end Android on patchy data (`apps/web/DESIGN.md`).

## 1. Data model

**Options.** (a) One row per message with `sender_id` and `recipient_id`, no
conversation row. Simple, but unread counts, requests and per-person state need
scans. (b) Conversation, participant and message tables. (c) The same, built
for groups now.

**Recommendation: (b), 1:1 enforced, groups deferred.** A group needs its own
rules for adding people, which is where minors are most at risk; do not carry
that now.

- `conversations`: `id`, `created_at`, `last_message_at`, `last_message_id`,
  `pair_key` (unique; the two member ids sorted and joined, so there is exactly
  one conversation per pair and a race creates one, not two).
- `conversation_participants`: `conversation_id`, `member_id`, `state`
  (`request`, `accepted`, `declined`), `last_read_message_id` (the read marker),
  `muted_at`, `hidden_at` (the member deleted the thread for themselves),
  `joined_at`. Primary key (`conversation_id`, `member_id`); index
  (`member_id`, `state`, `last_message_at` through the conversation) for the
  inbox.
- `messages`: `id` (uuid v7 or a bigserial; time-ordered, so paging is by id),
  `conversation_id`, `sender_id`, `body` (text, 1 to 2,000 characters),
  `client_id` (sender-chosen uuid, unique per sender, so a retry after a
  dropped connection does not post twice), `created_at`, `deleted_at`,
  `removed_by` (set when a moderator removed it).
- Unread = messages with id greater than `last_read_message_id` that the member
  did not send. The dot in the inbox is that, computed from the marker, never a
  stored counter.
- **Message request** is not a table: it is a participant row whose `state` is
  `request` for the recipient. Accepting sets `accepted`; declining sets
  `declined`, hides the thread and (see 2) suppresses further requests from that
  sender for 30 days. Fewer tables, one state machine, and the reported-by,
  blocked-by and rate-limit rules all read the same row.
- Replies, edits, reactions, attachments, read receipts to the sender, typing
  indicators and group chats are out of v1. Read receipts are deliberately not
  shown: they make declining to answer a social act, and a stalker's tool.
- Encryption: messages are encrypted at rest by the database/disk like all
  data, readable by the server. End-to-end encryption is not proposed (see 6:
  reports need the server to hold the text). The privacy copy says so.

## 2. Who can message whom

Rules are checked on the server, on every send, from live data, in one function
(`canMessage(sender, recipient)`), so the UI is only a hint. A member is
**DM-eligible** when all hold: the account is active; `isAdultFor(ageStatus, 'direct_messages')`
is true (a new purpose in `ADULT_ASSURANCE_REQUIRED`, set to `verified`); and
`dm_enabled` is true (their own opt-in).

1. Either side is not DM-eligible: refuse. The error is the same "this person is
   not available" for unverified, not opted in, suspended, deleted and blocked,
   so nothing is revealed about the other person's age or settings.
2. Either side blocked the other: refuse, same error. Existing threads freeze:
   readable to each side, sending refused.
3. The recipient follows the sender, or there is an accepted conversation: the
   message goes straight to the recipient's inbox.
4. Otherwise it is a **request**. The first message creates the conversation
   with the recipient in `request`. While it is a request the sender may send
   **one** message and sees "Waiting for [name] to accept"; further sends are
   refused until accepted. The recipient sees the text, from the Requests tab,
   with Accept, Decline and Block-and-report.
5. Mutes: a recipient who muted the sender gets the message in Requests state
   whatever the follow relationship, with no notification. The sender is not
   told. A sender who muted the recipient is unaffected.
6. Sender-side limits on opening requests: see section 5 (rate limits).

**Opt-in options.** (a) On for every verified adult, with an opt-out. (b) Opt-in,
default off (chosen by the owner). Under (b) a member who never opts in is
unreachable and invisible to DMs, which is the safe failure.

**Who may send requests.** Within opt-in, a second setting `dm_who`:
`requests` (default once on: people I follow reach my inbox, everyone else eligible
sends a request) or `following` (only people I follow can message me; no
requests). Both need the sender to be eligible too. Turning DMs off hides the
tab and the buttons, stops sends and pushes, and keeps existing data (section 9).

**Mutual-follow shortcut.** A message to someone you follow, who does not follow
you back, is still a request. Only the recipient's following the sender opens
the inbox. No other shortcut.

**Message button on profiles** (see UI spec): shown only to a DM-eligible viewer,
and only on the profile of a DM-eligible member who is not blocking or blocked.
For anyone else the profile shows no Message button and nothing that says why,
so a profile never reveals age status or opt-in. The viewer's own state is
handled in Settings, not on other people's profiles: an unverified viewer sees
the "Verify your age" prompt in Settings and in the Messages page, never next to
a specific person.

### Age verification gate

- **Source:** `restricted.age_assurances` through `ageStatus()` and `isAdultFor`.
  DMs read it server-side; the client never sends or sees an age. Moderators see
  only "minor" or "adult" where needed (rollout doc section 6).
- **Level needed: `verified`, as the owner decided.** The existing
  `declared` level is only a checkbox and is not enough. `reviewed` (a moderator
  decision) is also not enough: it is a correction mechanism, not a check.
  Question 1 asks whether to relax this to `declared` for an early beta, which
  this ADR does not recommend.
- **Not strong enough today:** nothing yields `verified` yet (Context). Options:
  (a) wait for NIN verification (`identity_provider`); (b) choose and build a
  separate age-assurance provider that does not need a NIN
  (`age_assurance_provider`); (c) an interim moderator-run check. **Recommendation:
  (b),** because NIN is optional and the rollout doc says age checks must not
  require it; (c) is not an assurance anyone can audit. This is its own
  roadmap item and needs a privacy review before this ADR's rollout step 4.
- **Both parties.** Each side must be verified and opted in, on every send, not
  just at conversation start. A verified adult cannot DM an unverified one, even
  an adult, and the recipient search never offers them.
- **When verification lapses.** `identity_provider` rows are tied to the
  verification (`verificationId`); if the verification expires or is revoked the
  assurance is withdrawn and `ageStatus` falls back to `declared`. Likewise a
  moderator finding the member is a minor (a later `moderator_review` statement
  does not outrank `verified`, so a revoked check or an explicit withdrawal is
  needed: the mistaken-age process must withdraw the verified row, a hook that
  does not exist yet). Effect, immediately on the next request: the member is no
  longer eligible; their conversations **freeze** (readable by both, sends
  refused, no pushes or badge counts, the other person sees "This person is
  not available for messages"); their `dm_enabled` choice is **kept** so
  re-verifying restores DMs without re-opting in, but nothing is delivered
  while lapsed; pending requests they sent stay but cannot be accepted; requests
  addressed to them are held (not shown) and purged after 30 days. Nothing is
  deleted by a lapse. A member shown to be under 18 additionally has their
  conversations closed for review by a human before anything is restored.
- **Existing accounts** with no age or only a declared age: not eligible, shown
  the verify prompt, and unaffected otherwise.
- **Review:** a minor's `review_after` never matters for DMs: a minor cannot become
  eligible by turning 18 until they verify as an adult.

## 3. Safety

- **Report a message.** Per-message menu: "Report". Reasons: the existing
  `REPORT_REASONS` plus a new `child_safety` (rollout doc section 6, priority
  triage). Reporting copies the reported message and the 10 messages around it
  into the report (`report_messages`, a snapshot, so the sender deleting it does
  not erase the evidence) and is the **only** way moderators ever see message
  text (section 8). Reports also offer "Block" and "Mute" in the same step. The
  reports table needs a nullable `message_id`; its current post/member
  shape does not carry it. Reports from inside a thread count to the report rate
  limit.
- **Block** from the thread header or message menu: uses the existing `blocks`
  table (blocking is account-wide, not DM-only, as on the rest of HeyNaija).
  Blocking also removes the thread from the blocker's inbox and declines it.
- **Mute** ("Mute notifications" for the thread, one click, in the thread header
  and on a notification): sets `muted_at`; messages still arrive, with no
  badge, push or email. This is separate from the account-wide `mutes`, which
  also moves new messages from that person to Requests.
- **Delete.** A sender can delete their own message for everyone for 10 minutes
  after sending ("This message was deleted" tombstone); a member can delete a
  whole thread for themselves at any time (`hidden_at`), which does not delete
  the other side's copy. A new message from the other side un-hides it unless
  they are blocked.
- **Retention.** Options: (a) keep until deleted; (b) auto-delete after N
  months; (c) keep while the account lives and for a fixed period after
  deletion for safety. **Recommendation: (a) with a purge.** Messages are kept
  while both accounts exist and neither has deleted them. When an account is
  deleted, its sent messages are deleted after 30 days (the existing deletion
  window; confirm against the account-deletion code), except messages held by
  an open or actioned report snapshot, which follow the report's retention
  (open question 4). Declined requests are purged after 30 days. Retention
  period and law-enforcement preservation need counsel (question 4); the privacy
  copy must state whatever is chosen.
- **Scanning.** The rollout doc asks for a "published retention and scanning
  policy". v1 proposal: no scanning of text; media is not allowed in v1, which
  avoids hash-matching. If images are added later they go through the same
  abuse-material scanning as uploads (`docs/safety/abuse-material-scanning.md`)
  first. Link previews are not fetched for messages.
- **Links.** Links in messages are plain text, not previewed, and an external
  link shows the destination host first when tapped (reuse existing link
  handling if any).
- **Unwanted contact.** A declined request blocks new requests from that sender
  for 30 days. Request senders also never see whether the request was read.
- **Account data export** (existing) includes the member's own sent and
  received messages.

## 4. Delivery

**Options.** (a) Polling and refetch-on-focus. (b) Server-sent events (SSE).
(c) WebSockets.

- SSE and WebSockets hold a connection open per tab: battery, radio wake-ups
  and dropped connections on mobile networks; the API also needs shared
  fan-out (Redis pub/sub is already available, since rate limits use Redis) and
  graceful reconnect. Corporate proxies and data savers break streams.
- Polling is dull, cacheable, trivially correct after being offline, and works
  with the existing request path.

**Recommendation: (a) for v1.** Inbox: refetch on focus, on route entry and
every 30 seconds while visible. Open thread: every 5 seconds while the tab is
visible and the thread is open, backing off to 15 seconds after 2 minutes with
no new message, paused when the tab is hidden, using `after=<last message id>`
so an empty poll is a few bytes (`304`/empty list). The unread badge in the
navigation reuses the notification count poll, with a dm count alongside, so no
second timer. Sending is optimistic with `client_id` for retry (UI spec).
Revisit SSE only if the measured median delay (up to 5 s) is a real complaint;
it is an addition behind the same endpoints, not a rewrite.

## 5. Notifications: push and email

- **In-app.** A "message" unread badge in the navigation (count of
  conversations with unread, capped at 9+), not in the notifications list: a
  message is not a notification row, so the bell does not get noisy.
- **Push (ADR 0011).** Off by default for DMs; a new switch in Settings,
  "Messages", default on once the member has push enabled at all. Wording
  follows the lock-screen rules: title "New message", body "[display name] sent
  you a message" with **no message text and no handle**; for a request, "New
  message request" with no name. The tag collapses repeats from one
  conversation into one notification. No push for muted conversations,
  muted or blocked senders, or requests the member declined, and at most one
  push per conversation per 5 minutes.
- **Email (ADR 0009).** No email for individual messages. The existing digest
  may carry one line: "You have unread messages" with a count and a link, never
  a name or text, and only if the member has `messages` email switched on
  (default off). Messages are not quoted anywhere outside the app.
- Moderation notices about messages (a report outcome) use the existing
  general-words wording.

**Rate limits** (add to `LIMITS` in `apps/api/src/rate-limit.ts`):

| Action | Limit |
| --- | --- |
| Send a message | 30 per minute, 300 per hour per member |
| Open a new conversation (a request) | 10 per hour, 30 per day |
| Messages to one request until accepted | 1 |
| Search for a recipient | the existing `search` budget |
| Report a message | the existing `report` budget |
| Poll endpoints | 60 per minute per member |

A member whose requests are declined or reported repeatedly (threshold to tune,
start with 5 in 7 days) loses request-opening for 7 days and is flagged for a
moderator.

## 6. API

All routes under `/v1/messages`, all require a signed-in member, all return
404 when the feature flag is off for that member, all are checked on the server
with `canMessage` and the age rule. Never cached publicly (`Cache-Control:
private, no-store`). Cursor paging by message id.

| Endpoint | Auth and rule |
| --- | --- |
| `GET /v1/messages/conversations?tab=inbox\|requests&cursor=` | Own participant rows only. Hidden and declined excluded. |
| `GET /v1/messages/conversations/:id?after=&before=` | Participant only; 404 for anyone else (not 403). Updates nothing. |
| `POST /v1/messages/conversations` `{ recipientId, body, clientId }` | `canMessage`, request limits. Idempotent on `pair_key`. |
| `POST /v1/messages/conversations/:id/messages` `{ body, clientId }` | Participant, `canMessage`, request-state cap, send limit, idempotent on `clientId`. |
| `PUT /v1/messages/conversations/:id/read` `{ upToMessageId }` | Participant. Only moves the marker forward. |
| `PUT /v1/messages/conversations/:id/accept` | Recipient in `request` state only. |
| `PUT /v1/messages/conversations/:id/decline` | Recipient only; hides, starts the 30-day suppression. |
| `PUT` / `DELETE /v1/messages/conversations/:id/mute` | Participant. |
| `DELETE /v1/messages/conversations/:id` | Participant; hides for self only. |
| `DELETE /v1/messages/:id` | Sender, within 10 minutes. |
| `POST /v1/messages/:id/report` `{ reason, details }` | Participant who did not send it. Snapshot, report limit. |
| `GET /v1/messages/unread` | The badge counts. |
| `GET /v1/messages/recipients?q=` | New-message search: only DM-eligible members (verified adult, opted in) that `canMessage` would allow, none blocked in either direction. An ineligible caller gets 404. |

Settings: `PUT /v1/settings/messages` `{ enabled: boolean, who?: 'requests' | 'following' }`.
`enabled: true` is refused (403, "verify your age first") unless the caller passes
the age gate. `GET /v1/me` returns `messages: { available, enabled, needsVerification }`
for the UI.
Blocking uses the existing block endpoint; a block also declines the thread.

The recipient search must not become a way to enumerate members or find who is verified:
it needs an exact-prefix match on handle or name, a minimum of 2 characters, the
existing search limit, and returns nothing for ineligible members rather than
an error.

## 7. Moderator and abuse access

**What moderators cannot see:** conversations that nobody has reported, the
inbox of any member, who messages whom, message counts per person, or search
across message text. There is no moderator inbox and no staff read path; the
`mod` role gains nothing from this feature.

**What they can see:** a reported message and the snapshot of the surrounding
messages stored with the report (section 3), the reporter, and the reported
member's account. Decisions go in the existing moderation log (`MODERATION_ACTIONS`
gains `remove_message`, `suspend_for_messaging`). Moderators can remove a
message (tombstone with "removed by a moderator"), restrict a member from
sending messages, or suspend the account. Opening a snapshot is itself logged.

**Automatic signals** (no text read): a member with many declined or reported
requests (section 5) is surfaced in the queue as a counter, not as content.

**Open for governance (question 3):** whether a trustee or a named safeguarding
lead may read a whole conversation without a report in a child-safety or legal
emergency, under what written authority, who approves it, how it is logged, and
how the member is told afterwards. Until governance decides, nobody can.
Law-enforcement requests are handled outside the product by the owner, per
counsel.

## 8. Privacy copy (draft, for counsel to approve before launch)

Shown once before first use, and in the privacy policy:

> **Messages are private, but not secret.** Only you and the person you message
> can read them. We do not read them and moderators cannot see them. If you
> or the other person reports a message, we keep a copy of that message and
> the ones around it so a moderator can look into it. We can also be required
> by law to share messages. Messages are not end-to-end encrypted.
> Deleting a message removes it for both of you; deleting a conversation
> removes it only for you. People you do not follow can send you one message
> request. You can block, mute or report anyone at any time.

Message requests copy: "[Name] wants to send you a message. They can't see if
you've read it. Accepting lets you both chat." Waiting copy to the sender:
"Your message was sent. [Name] will see it as a request. You can send more after
they accept." (No claim on whether it was seen.)

The privacy policy, Terms, Rules and the data-export notes all change when this
ships, and the `/charter` "no private content" promises, if any, must be
checked (grep before building).

## 9. Feature flag

- `DIRECT_MESSAGES_ENABLED` (API env, default `false` in every environment). The
  web never reads the flag; it asks
  `GET /v1/me` for `features.messages`, so a build with the flag off ships no
  dead UI route that responds.
- Per-environment: local on by default in dev compose only; staging on after
  the backend stage; production off until step 5 below.
- Per-member allow-list during testing: `restricted`-style table or env list
  `DIRECT_MESSAGES_MEMBERS` (handles) used only in staging/production beta, so
  a first production trial can be five named adults.
- **Verified adults who opted in, never anyone else.** The flag is not enough:
  `canMessage` re-checks the age gate and the opt-in on every request, and a test
  must fail the build if `UNDER_18_ACCOUNTS_ENABLED` is turned on while the gate
  is missing. Unlike `lockedOff` flags, this one can be turned on, so the age rule
  must live in code, not config. Even with the flag on, nobody is eligible until
  an age check exists that yields `verified` (Context).
- Turning the flag off hides the feature and refuses sends but leaves data in
  place (no deletion on disable).

## 10. Rollout

1. **Design (this ADR).** Review by the owner. Open questions answered.
2. **Backend behind the flag.** Schema, migration, `canMessage` with the age,
   block, mute and request rules, the endpoints, rate limits, report snapshot,
   purge job. Tests first for every rule in section 2. Staging only.
3. **UI behind the flag.** Inbox, thread, requests, new-message dialog,
   settings, push/email wording, per the UI spec. E2E tests in `e2e/tests`
   (using `newMember`).
4. **Safeguards sign-off.** An age check that yields `verified` chosen, built
   and privacy-reviewed (`age-verification`); `minor-safeguards` approved or
   explicitly scoped (v1 is verified adults only, by owner decision, so its
   remaining parts may be scoped out if the owner says so); counsel on privacy
   copy and retention; moderator runbook for message reports; governance answer
   on emergency access. Roadmap dependencies resolved or changed accordingly.
5. **Enable.** Staging soak with named members, then production for an allow-list
   of adults, then everyone 18+. Watch report rate, decline rate and blocks per
   message for two weeks before widening. The roadmap entry moves to
   Implemented only after the owner confirms it live in production.

## Consequences

- No new table for requests; the participant state carries it.
- The report model needs a message reference and a snapshot table.
- The notifications and email code need a "messages" switch and wording that
  never includes text.
- Polling costs a request every 5 seconds per open thread; the per-member poll
  limit and the 304 path keep that cheap.
- Moderators cannot proactively find abuse; it depends on reports and the
  request-decline signals. This is a deliberate privacy trade-off.

## Open questions

Kept in the PR description with recommendations. In short: (1) what "age
verification" is, since nothing yields `verified` today, and whether `declared`
is acceptable for an early beta (recommended: no); (2) whether both parties
must be verified (recommended: yes, as written); (3) emergency access to
unreported messages; (4) retention period, report snapshot retention and
law-enforcement preservation; (5) whether v1 allows images (recommended: no);
(6) what happens on lapse (recommended: freeze, keep the opt-in, delete
nothing); (7) polling vs SSE (recommended: polling); (8) who writes the
moderator runbook; (9) whether a minor opt-in is ever wanted (recommended: a
separate ADR, not v1).
