# ADR 0016 — Deleting an account: off the site at once, erased after 14 days

**Date:** 29 October 2026 · **Status:** Accepted 29 October 2026; built 30 October 2026, not yet deployed ·
**Roadmap:** `account-deletion` · **For counsel:** entries C-01 to C-15 in
[the counsel log](../governance/counsel-log.md)

## Decision

A member can delete their account from Settings, and HeyNaija can delete one
when asked by email. Deletion happens in two stages.

1. **Requested.** The account is deactivated at once: `members.active` goes
   false, every session is ended, and the member disappears from every page, as
   a suspended member does. Nothing is erased yet. For
   `ACCOUNT_DELETION_GRACE_DAYS` (14) they can sign in again and cancel; the
   only other things they can do are download their data and sign out.
2. **Erased.** When the grace period is over, a job erases the account: the
   Kratos identity (email address, sign-in methods, sessions) is deleted,
   everything personal in the app's database is deleted or blanked, and their
   images are deleted from storage and from the CDN's cache. The `members` row
   stays as a blank **tombstone**, so the records other people and moderators
   rely on still point somewhere.

Kept on purpose, as evidence: reports about the member and their posts,
moderation decisions, the posts that were reported or taken down (until the
retention sweep), images moderators took down or the scanner blocked, and the
governance audit trail.

Every request, from Settings or by email, is a row in `privacy_requests`, with
when it came in, when it is due and when it was done.

Suspension and deletion are independent. A suspended member can ask for
deletion; cancelling it leaves them suspended; reinstating a member who asked
for deletion does not bring them back; and a member waiting for deletion cannot
appeal (they can cancel first).

## Why

- **Two stages, because erasure cannot be undone.** Someone who took over a
  session, or a member who regrets it straight away, has 14 days to undo it. The
  grace period also gives moderators time to decide open reports before the
  account goes.
- **Deactivated at once**, because what the member asked for, being off the
  site, should not wait. `SessionGuard` reads `members.active` uncached, so it
  takes effect on the next request.
- **The Kratos identity stays active during the grace period.** Deactivating it
  in Kratos would stop the member signing in to cancel. The app's own `active`
  flag already shuts them out of everything else.
- **Deletion has its own columns** (`deletion_requested_at`,
  `deletion_scheduled_for`, `deleted_at`), not a value of `status`. `status`
  means "suspended", and reinstating sets it to null, so a moderator reinstating
  someone would silently cancel their deletion.
- **A tombstone, not a deleted row.** No foreign key to `members.id` cascades.
  Making them cascade would be a breaking migration (after `BASELINE = 27`) and
  would delete evidence and other people's records with the member. And
  `SessionGuard` creates a `members` row for any identity that redeemed an
  invite, so the row must exist for as long as the identity can still sign in.
- **Counters are left to the triggers.** Deactivating a member moves their
  likes, replies and reposts out of `like_count`, `reply_count` and
  `repost_count` (`members_active_counts`, migrations 0011 and 0015). The delete
  and visibility triggers only count active members, so deleting an inactive
  member's likes and reposts, or deleting their replies, changes no count again.
  So: deactivate first, delete afterwards, never adjust a count by hand, and
  never flip `active` during an erase. These are the only triggers in the
  schema.

## The tombstone

`handle` is `NOT NULL`, so an erased member's handle becomes `deleted-` and the
first eight hex digits of their ID, such as `deleted-3f2a9c1b`.

- It can never be a real handle: it has a `-`, and Kratos allows only
  `^[a-z0-9_]{3,20}$`.
- Nothing can look it up: `handleParam` (`apps/api/src/http.ts`) refuses it, so
  no `/u/` page or API call reaches it, and the mention pattern cannot match it.
- It is short enough for the moderation log and queue, where it shows who did or
  reported something, and two erased accounts there can be told apart.
- It need not be unique: `members.handle` is not, and nothing looks a tombstone
  up by handle.

The member's real handle is held for `HANDLE_HOLD_DAYS` (30) from the erase, in
`released_handles` (ADR 0004), so nobody can take it straight away and pass
themselves off as them. `movedTo` follows only active members, so `/u/<old
handle>` answers 404 and leads nowhere. Renames are refused while a deletion is
pending (the Kratos settings webhook), and the session guard stops copying the
handle once deletion is asked for, so the handle in `members` is the one Kratos
has, and that is the one held. The hold is written before the Kratos identity is
deleted, so the handle is never free and unheld. One gap is accepted: a member
who renames and asks for deletion within the 30 seconds the API takes to notice
a rename (ADR 0004) has the new handle freed, not held.

## What happens to each piece of data

"Hidden" means it is already out of every page because the member is inactive.
**Evidence posts** are the member's posts that were taken down by a moderator or
reported at any time, whatever the outcome; everything a moderator has looked at
or still has to look at. Their other posts are **ordinary posts**.

### The account row (`members`)

| Data | At request | At erase | Class |
| --- | --- | --- | --- |
| `id` | — | kept | keep (tombstone) |
| `handle` | — | `deleted-…`; real handle held 30 days | blank |
| `display_name`, `bio` | hidden | null, `''` | blank |
| `avatar_media_id` | hidden | null; photo deleted (see Media) | blank |
| `active` | false (counts move) | stays false | — |
| `status` | unchanged | unchanged | keep (evidence of a suspension) |
| `role` | unchanged | `member` | blank |
| `last_seen_at`, `onboarded_at`, `last_notification_email_at` | — | null | blank |
| `email_notifications` | — (email skips inactive members) | false | blank |
| `pinned_post_id` | hidden | null | blank |
| `created_at` | — | kept | keep |
| `deletion_requested_at`, `deletion_scheduled_for`, `deleted_at` | set | `deleted_at` set | keep |

### What they wrote

| Data | At request | At erase | Class |
| --- | --- | --- | --- |
| Ordinary posts (`posts`) | hidden | `deleted_at` set if not already; `text` `''`, `link_url` and `quote_post_id` null | blank; the row stays as the parent of others' replies and the target of their likes, reports and notifications |
| Mentions and hashtags in ordinary posts (`post_mentions`, `post_hashtags` by `post_id`) | hidden | deleted | delete |
| Evidence posts | hidden | `deleted_at` set; text, link, mentions and hashtags kept until the retention sweep | keep until sweep |
| Mentions of them in other people's posts (`post_mentions.member_id`) | — | deleted, so the `@handle` stays plain text | delete |
| Titles of their ideas (`ideas.title`) | hidden (off the board) | `''` for ordinary posts, kept for evidence posts | blank / keep until sweep |
| Where their problem reports happened (`problem_details`) | hidden | deleted | delete |
| Their post pinned in a community (`communities.pinned_post_id`) | hidden | null | blank |
| Polls on their ordinary posts (`post_polls`, with `poll_options` and every member's `poll_votes` on them) | hidden | deleted | delete |
| Polls on their evidence posts | hidden | kept with the post; the retention sweep deletes the poll when it blanks the post | keep until sweep |
| Other members' likes, reposts and bookmarks of their posts | hidden | kept: the other member's data; the post shows as gone | keep |

`replies_count_visibility` fires when `deleted_at` is set on their replies, but
does nothing for an inactive author. The text search index follows the text.

### What they did, and who they know

| Data | At request | At erase | Class |
| --- | --- | --- | --- |
| `likes`, `reposts` by them | out of the counts (trigger) | deleted; triggers change nothing | delete |
| `bookmarks` | — | deleted | delete |
| `idea_votes` by them | not counted (votes are counted from active members on read) | deleted | delete |
| Their votes in polls (`poll_votes.member_id`) | out of the counts (trigger and `active` move them) | deleted; the trigger counts active voters only, so nothing moves | delete |
| Their place in other members' Gists (`gist_members.member_id`) | disconnected by the reconciler (see Edge cases) | deleted; the Gist and its other members stay. `role_changed_by` and `removed_by` naming them stay, pointing at the tombstone | delete |
| Gists they hosted (`gists.host_id`, title) with everyone's `gist_members` rows in them | a live one ends (see Edge cases) | deleted, members first. No audio is stored; a Gist without its host and title is nothing | delete |
| `follows`, `blocks`, `mutes`, both ways | hidden | deleted | delete |
| `community_memberships`, including moderator roles | — | deleted | delete |

### Notifications and devices

| Data | At request | At erase | Class |
| --- | --- | --- | --- |
| Notifications to them (`recipient_id`) | not emailed or pushed (both skip inactive members) | deleted | delete |
| Notifications about something they did (`actor_id`) | hidden (actor inactive) | deleted | delete |
| "Your report about @… was actioned", to reporters (`subject_id`) | — | kept: the reporter's record; shows the tombstone handle | keep |
| `notification_opt_outs` | — | deleted | delete |
| `push_subscriptions` | nothing pushed | deleted | delete |

### Moderation and governance records

| Data | At request | At erase | Class |
| --- | --- | --- | --- |
| Reports about them or their posts (`reports.member_id`, `post_id`) | unchanged, still in the queue | kept | keep (evidence) |
| Reports they made (`reporter_id`, `details`) | unchanged | kept, still open if open, and still linked to the tombstone: a null reporter means the upload scanner | keep (evidence) |
| Their open appeal | stays open | closed as dismissed, with no moderator: there is no account left to reinstate | keep |
| Decisions they took or that were taken on them (`moderation_actions`, `reports.resolved_by`, `idea_status_changes.moderator_id`) | — | kept | keep (evidence) |
| The timeline of their ideas (`idea_status_changes`) | — | kept: moderators' words | keep |
| `restricted.age_assurances` | — | deleted; the audit trail keeps that an 18+ declaration was made, and when | delete |
| `restricted.identity_verifications` | — | kept; a live one is revoked (`outcome = member_deleted`) so the badge goes and the person can verify a new account. Verification is switched off and no rows exist | keep |
| `restricted.governance_memberships` | — | kept (switched off; no rows exist) | keep |
| `restricted.governance_audit_log` | — | kept for [period] (counsel): append-only, codes only, no free text. It is the evidence that the 18+ rule was applied | keep ([period]) |
| `profile_badges` (Founder, identity tick) | hidden | deleted | delete |

### Media (`media` rows and the files they name)

| Data | At request | At erase | Class |
| --- | --- | --- | --- |
| Current and old profile photos, `ready` | hidden | deleted from the bucket and purged from the CDN; quarantined instead if a report about the account is open | delete |
| Images of ordinary posts, `ready` | hidden | deleted and purged | delete |
| Images of evidence posts, `ready` | hidden | quarantined (kept privately, like images of removed posts) | keep until sweep |
| `quarantined`, `blocked` (and the blocked original in `uploads/quarantine/originals/`) | — | kept | keep (evidence) |
| `pending`, `processing` uploads | — | marked deleted; the upload removed from the `uploads` bucket | delete |

Keys: `avatars/<id>/{96,256}.webp` and `posts/<id>/{640,1600,still}.webp` in the
media bucket; `avatars/<id>` and `posts/<id>` in the uploads bucket while being
processed; `quarantine/…` for what is kept.

### Handles, invites and the new tables

| Data | At request | At erase | Class |
| --- | --- | --- | --- |
| Handles they gave up by renaming (`released_handles.member_id`) | — | holds still running are kept until they run out; older rows deleted; the retention sweep deletes the rest as they run out | delete when the hold ends |
| Their real handle | — | a new hold, 30 days | keep until hold ends |
| `invite_redemptions` | — | deleted: it says which invite brought them in, and an invite's `note` may name them | delete |
| `invites` | — | nothing: there is no column for who made an invite (operators make them from the command line) | — |
| `privacy_requests` | a row (`deletion`) | completed; kept as the record that the request was handled, with `member_id` pointing at the tombstone | keep ([period] on `/privacy`) |
| `link_previews` | — | kept: shared by every post linking to a URL, nobody's in particular | keep |

## Outside the app's database

| Where | What | At request | At erase |
| --- | --- | --- | --- |
| Kratos identity (`kratos` database) | email, handle, sign-in methods (email code, Google's subject ID), verified addresses | stays active, so they can sign in to cancel | deleted through the admin API |
| Kratos sessions | sessions and their devices (IP address, browser) | all ended through the admin API (a 404 means none was left) | ended again, then deleted with the identity, which also ends any session left |
| Kratos's sent mail (`courier_messages`) | every email Kratos sent: the address, the subject (with the sign-in code), the identity as it was (email, handle) and the browser's User-Agent | — | not deleted with the identity, and Kratos never cleans them up (checked 29 October 2026). `infra/deploy/kratos-cleanup.sh` deletes everyone's once older than `KRATOS_SENT_MAIL_KEEP_DAYS` (7), every night before the backup, so an erased member's are gone within a week and never reach a backup older than that |
| R2 media bucket | their published images | still there, unlinked | deleted |
| Cloudflare's cache | copies of published images, for up to a year | — | purge queued for every deleted image |
| Redis | whoami cache (a hash of the cookie, to the ID and handle; 30 s), rate limits (`hn:limit:*:<ID>`; an hour at most), `digest-<ID>` and `push-<ID>` jobs (removed when done; failures kept an hour at most) | all run out on their own | nothing left by then to delete; the `erase-<ID>` job holds only the ID, and a failed one, kept a day, a reason with nothing personal in it |
| Backups | both databases, nightly, encrypted, kept 30 days | cannot be edited | age out within 30 days of the erase; `/privacy` says so |
| Logs | API logs (member IDs, never emails or handles), nginx and Cloudflare (IP addresses) | — | age out after [period] |
| The SMTP provider | its own record of mail sent | outside HeyNaija's control | — |
| The member's browser | `hn_session`, `hn_push`, choices remembered on the device | asking in Settings clears both cookies in that browser; on other devices the session is already ended in Kratos, and the cookie left behind opens nothing | — |

## Asking, from Settings

`v1/me/deletion` (`AccountController`), never cached:

- `GET`: `{ state: 'none', graceDays }`, or `{ state: 'scheduled', scheduledFor }`.
- `POST { confirmHandle }`: the member types their handle (an `@` and capitals
  are ignored) and must have signed in within the last 15 minutes, read from
  Kratos's `authenticated_at` uncached, so a session left open on a shared
  computer cannot delete the account. A wrong handle is a 400
  (`handle_mismatch`), an older sign-in a 403 (`reauth_required`). Signing in
  again with `refresh=true` keeps the session and moves that time forward. A
  site moderator gets a 403 (`site_moderator`). Asking again returns the same
  date.
- `DELETE`: cancels. With nothing to cancel it is a 204 too; once the erase is
  due, a 409 (`too_late`).

Asking and cancelling share a limit of five an hour (`accountDeletion`), since
each request ends every session and sends an email. The endpoints use
`SuspendedAllowedGuard`, which lets in a member who is inactive but not erased:
a suspended member may ask for deletion, and one waiting for deletion is
inactive until they cancel. What else it guards stays open to both: appeals
(which refuse a member waiting for deletion), the data export, and stopping
push on a device.

In the web app, Settings links to `/settings/delete`: what is erased and what is
kept, the grace period, the data download, and the form. The form is outside
every `<Suspense>`, so it works without JavaScript. A production build cannot draw
a refused action's message into that prerendered shell, so without JavaScript a
refusal leads to `/settings/delete/refused/<reason>`, a prerendered copy of the
page with the message above the form. Asking ends every session,
this one too, and Kratos's logout refuses a session that has ended
(`session_inactive`, checked 30 October 2026), so neither it nor `/logout` can
follow. The server action instead drops the dead session cookie and the push
cookie (nothing is pushed to an inactive member), and redirects to
`/settings/delete/scheduled`. The date travels in an hour-long cookie
(`hn_deletion`, on that path only), since that page is signed out. A
`reauth_required` answer sends the browser through Kratos's refresh sign-in
(`/self-service/login/browser?refresh=true`, the same one Settings uses before
an email change) and back to the form, where the member confirms once more. The
browser opens that itself, as for joining, so Kratos's cookies reach it; without
JavaScript the action redirects straight to Kratos.

Signing in during the grace period, `GET v1/me` answers `account_inactive`, so
the web app asks `GET v1/me/deletion`: a scheduled deletion shows the date, Keep
my account and Sign out instead of the feed. Otherwise the member is suspended
and sees what they always did, now with a link to delete the account instead.

## Asking by email

An operator records the request the day it arrives (`pnpm privacy-request
record`), so its due date runs from then, and once the person has confirmed it
from the account's own address runs `delete-account --request <id>`. That calls
the same `AccountDeletionService.request` as Settings, on the `email` channel,
and puts the recorded request in progress instead of adding another; `--now`
also queues the erase at once. The command only asks: it needs the database,
Redis and Kratos's admin API, never storage or CDN keys (`loadPrivacyToolEnv`).
The runbook is [docs/governance/privacy-requests.md](../governance/privacy-requests.md).

Either way, the member is emailed "Your HeyNaija account will be deleted on
[date]", with how to keep it, at their own address (`EmailDeletionNotices`), if
SMTP is configured. A failure there is logged by member ID and changes nothing.

## Erasing, step by step

The erase must be safe to repeat after a failure at any step. Each attempt runs
every step; a step already done changes nothing.

1. **Read the identity from Kratos** (admin API): the email address, for the
   "your account has been deleted" email, and the handle Kratos has. A 404 means
   it is already deleted: carry on without them.
2. **End every session** again, in case they signed in during the grace period.
3. **One Postgres transaction** applying the tables above: the tombstone and
   the handle holds. Every statement can run twice.
4. **Storage:** delete the files of every media row the transaction marked
   deleted, quarantine evidence images, and queue CDN purges.
5. **Email** the address from step 1, if SMTP is configured: "Your HeyNaija
   account has been deleted". A mail server that refuses it for good (a dead
   address) does not hold the erase up; one that is away does, so the email gets
   the erase's retries.
6. **Delete the Kratos identity.** A 404 counts as done.
7. **Finish:** set `deleted_at` and mark the privacy request completed, in one
   transaction.

`deleted_at` means the whole erase is done, so it is set last. The hourly scan
picks members whose deletion is due and whose `deleted_at` is still null
(`members_deletion_due_idx`), so an erase that gave up part-way is tried again
instead of leaving a Kratos identity behind. A retry between steps 5 and 6 can
send the email twice; that is accepted.

Cancelling is possible only before `deletion_scheduled_for`. The cancel and the
erase each lock the member's row first, so a cancel at the last moment and the
erase cannot both happen.

### On a schedule

The account worker (`apps/api/src/account/account-queue.ts`) runs in the API
process, on its own BullMQ queue, one job at a time:

- **Every hour, the erases due.** One `erase` job per account, with the member's
  ID as its job ID, so an account is never queued twice. An erase that fails is
  tried eight times over about two hours (1, 2, 4 … 64 minutes apart). If every
  try fails, an error names the member, and the failed job is kept for a day,
  which keeps the scan from queueing it again; then it has another round. The
  account stays off the site all the while. A finished job is removed at once,
  so a deletion asked for again after a cancel can be queued.
- **Every hour, what is kept only for a while.** Handles held for an erased
  account are deleted once their 30 days are over: a running hold is all that
  needed them. If `DELETED_CONTENT_RETENTION_DAYS` is set, every post deleted
  longer ago than that (the ones members delete and the evidence posts of erased
  accounts) is blanked as an ordinary post is at erase: text, link, quote,
  mentions, hashtags, idea title, problem details and poll (options and votes
  with it). A post with a report about
  it still open is kept until it is decided. Unset, nothing is blanked (counsel
  log, C-04).
- **Every day, overdue requests.** A warning lists the privacy requests still
  open past `due_by`, by ID, kind and due date.

The worker logs counts and IDs only. A failed job's reason is the error's kind
and code, never its message, both in the log and in the failed job Redis keeps:
Drizzle's message holds the query's parameters (a handle, in the erase), and a
mail server's can name the address it refused. Messages written in this code
(the deletion's own errors, Kratos being unavailable) are kept as they are.

## Edge cases

- **Site-wide moderators** cannot delete their own account in Settings. They are
  told to ask to be demoted first (`pnpm mod:revoke`), as with suspension. This
  covers "the last site-wide moderator" without counting anyone. The operator
  path can still delete a moderator; erasing sets `role` back to `member`.
- **A live Gist they host** ends by itself: the request makes them inactive, so
  the Gist reconciler (`GistsService.reconcile`, every minute) disconnects them,
  marks them gone, and ends the Gist once its host has been gone two minutes;
  the erase then deletes it. There is no co-host takeover.
- **Founders** can delete their account; the Founder badge goes with it.
- **Community moderators**, including a community's only moderator, can delete
  their account. Site moderators can act in every community, so none is left
  unmoderated; the roster shows it has no moderator. The erase logs which
  communities were left with none.
- **Suspended members** can ask for deletion (above). Their `status` stays on
  the tombstone as part of the record. A member waiting for deletion can be
  suspended too, so cancelling does not bring them back.
- **An open appeal** stays open during the grace period. If a moderator accepts
  it, `status` is cleared but the member stays inactive; if they then cancel the
  deletion, they are active again. New appeals are refused while deletion is
  pending. At erase, an appeal still open is closed.
- **Open reports against them** do not hold up the erase: the grace period is
  the moderators' time. The evidence posts and any reported photo are kept; the
  name and bio are not (see Consequences).
- **Reports they made that are still open** stay in the queue, shown as made by
  the tombstone.
- **Pinned posts:** their profile pin and any community pin of their post are
  cleared at erase. Both are already hidden from the request, since the author
  is inactive.
- **Their ideas** leave the board from the request. Other members' votes for them
  stay, unseen. An idea marked a duplicate of theirs keeps pointing at it; the
  board already hides an original by an inactive author.
- **A session during the erase.** The whoami cache can still answer for up to
  30 seconds after the identity is deleted. `SessionGuard` does not copy a handle
  or `last_seen_at` onto a member whose deletion was requested, and treats an
  erased row as no account, even where suspended members are let through.
- **Notifications to a tombstone:** a report they made being decided, or a
  moderator removing one of their evidence posts, would notify them.
  `notify()` skips erased recipients.
- **Coming back.** The email address is free once the identity is deleted, so
  they can join again with a new invite, as a new member. Their old handle is
  held for 30 days from the erase, from them too.

## Changes made in existing code

- `SessionGuard`: the handle and last-seen rule above.
- The Kratos settings webhook (`/internal/kratos/settings`) refuses a rename
  while a deletion is pending.
- `ModerationService`: both reinstatement paths keep `active` false while
  deletion is requested; `appeal` refuses a member waiting for deletion;
  `setSuspended` finds a member waiting for deletion when suspending, and only
  suspended members when reinstating.
- `MediaService.discard` queues a CDN purge. It used to delete the files from
  the bucket only, so an image a member deleted, or a photo they replaced, could
  still be served from Cloudflare's cache for up to a year to anyone who had its
  address. `MediaService.eraseFilesOf` does the erase's storage step.
- `MembersService.holdHandle` can run inside a transaction.
- `notify()` skips erased recipients.
- `PostsService` thread reads: an erased member's post comes through where
  deleted posts already do, so it is shown as an unavailable placeholder and
  other people's replies under it stay in the thread. The web app draws every
  deleted post without its author. Only once erased: during the grace period the
  account is hidden like a suspended one, since it may come back.
- The API refuses to start with `ACCOUNT_DELETION_GRACE_DAYS` above
  `PRIVACY_REQUEST_DUE_DAYS`: every deletion would be late.
- `LIMITS` gains `accountDeletion` (five an hour).

## Release

- **API and web app in one deploy.** The web app's deletion pages call
  endpoints only the new API has. `migrate` (0030) runs before `api` starts
  (compose: `depends_on: migrate: condition: service_completed_successfully`),
  and the new API needs it: the session guard reads the new columns.
- **Settings: none to add.** `ACCOUNT_DELETION_GRACE_DAYS` (14) and
  `PRIVACY_REQUEST_DUE_DAYS` (30) default when empty, and the API refuses to
  start if the first is larger. Leave `DELETED_CONTENT_RETENTION_DAYS` empty
  until counsel sets the period (C-04): nothing is blanked meanwhile.
  `KRATOS_ADMIN_URL` comes from compose. The emails use the notification SMTP
  settings, and are not sent without them. The nightly backup reads
  `KRATOS_SENT_MAIL_KEEP_DAYS` (7).
- **Nothing to install on the server.** `backup.sh` and `kratos-cleanup.sh`
  come with the checkout, and the existing cron runs the clean-up before the
  next backup.
- **After deploying, check:**
  - The API log shows no `AccountWorker` errors.
  - With a test account: Settings → Delete your account signs it out onto
    "Your account will be deleted" with the date, and the email arrives.
    Signing back in shows "Your account is being deleted"; Keep my account
    brings the feed back.
  - `docker compose exec api node dist/cli/privacy-request.js list` leaves
    nothing open from that test.
  - The next morning, `backup.log` has "deleted N of Kratos's sent emails older
    than 7 days" before the backup line.

## Rollback

- Migration 0030 only adds columns and a table. Older code ignores them.
- Rolling the API back pauses erasure, since the job is new code. Accounts
  waiting for deletion stay inactive (older code reads `active`) and are erased
  once the new code is back. The account queue's scheduled jobs wait in Redis
  meanwhile; nothing else reads them. Older code's reinstatement would reactivate a
  member waiting for deletion, so nobody should be reinstated while rolled back.
  Older code also shows such a member the suspended page instead of the choice to
  keep their account, and nobody can ask for deletion in Settings meanwhile.
- Cancelling is the undo for a request. An erase cannot be undone. Restoring a
  backup from before it brings the account back: if the app's database is
  restored, the scan erases it again on its own (its deletion is due and its
  request not completed); erasures requested after the backup was taken are
  known only from the erase log lines (member IDs), and the restore runbook must
  re-apply them.

## Consequences

- An erased member's name and bio are gone even if a report about them was still
  open. A report's own `details` and the evidence posts remain.
- Moderators see reports a deleted member made as made by `@deleted-…`, and can
  still tell when one account made many.
- `/privacy#keep` gains what is kept after deletion (including the record that
  an 18+ declaration was made), that backups age out in 30 days, and that copies
  of sign-in emails are kept 7 days; its placeholders gain the retention of
  privacy request records and of that record.

## Not done

- A legal hold that stops an erase while a case is open.
- A snapshot of a reported profile kept as evidence.
- A retention sweep for quarantined images (it has its own placeholder on
  `/privacy`); the sweep here blanks post text only.
- A page for operators. Requests by email are recorded, acted on and closed with
  `pnpm privacy-request` ([the runbook](../governance/privacy-requests.md)).

## Settled while writing this

Three points where the first plan and the code disagreed, decided on 29 October
2026:

1. **Reports a deleted member made keep their link to the tombstone.** The plan
   had them lose it (`reporter_id` null), but null already means "filed by the
   upload scanner": the schema says so, and the moderation queue shows it that way
   (`apps/web/app/(main)/mod/page.tsx`). An appeal, which names its author twice,
   would have looked like the scanner reporting them. The tombstone holds nothing
   personal, and the same ID is already on their evidence posts and moderation
   records. Rejected: null plus a new column saying who filed it, which changes
   every reader of a null reporter and hides one account filing many reports.
   Counsel log C-05.
2. **The age record is deleted, its audit entry kept.** `/privacy#keep` promised
   age confirmation only for as long as the account exists. The audit log already
   records that an 18+ declaration was made, and when, so deleting it too would
   leave no evidence that the 18+ rule was applied, and break its append-only
   rule. `/privacy` will say what is kept and for how long. Rejected: keeping
   `age_assurances` as well (more than the evidence needs), or deleting both.
   Counsel log C-06.
3. **Erased members' posts are placeholders in threads** (see Changes above).
   Today a post by an inactive member is left out of a thread altogether, so
   other people's replies under it could be reached only by link. Rejected: the
   same for suspended members, which would change what suspension means.
