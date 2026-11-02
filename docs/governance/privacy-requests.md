# Privacy requests: handling them

**Status:** working practice, 30 October 2026. Counsel has not reviewed it yet:
the deadline, how to confirm who is asking and what a reply must say are open
questions C-02, C-03 and C-15 in the [counsel log](counsel-log.md). Change this
page when they are answered.

A privacy request is someone asking HeyNaija to show them, correct, delete or
stop using what it holds about them. Members do two of these themselves in
Settings: **Download your data**, and **Delete your account**, which records
itself as a request. Everything else arrives by email, at the address on
`/privacy` (contact@heynaija.ng), and is handled here. The design is in
[ADR 0016](../adr/0016-account-deletion.md).

## The tool

Every request is a row in `privacy_requests`, with when it came in, when it is
due and when it was closed. The `privacy-request` command records and closes
them. On the server, in the API's container:

```bash
cd /srv/heynaija/infra/deploy && docker compose exec api node dist/cli/privacy-request.js <command>
```

On a development machine: `pnpm privacy-request <command>`.

| Command | What it does |
| --- | --- |
| `record --email <address> --kind <kind> [--notes <text>]` | Records a request the day it arrives, so its due date runs from then. `--email` is the address it came from; the command asks Kratos which account has it, and records it without one if none does. `--handle <handle>` instead names the account directly. `<kind>` is `access`, `correction`, `deletion`, `objection` or `other`. |
| `list [--overdue]` | The requests still open, the soonest due first, with the account's handle. `--overdue` shows only those past their due date. |
| `delete-account --request <id> [--now]` | Takes the account off the site and schedules its erase, closing the deletion request `<id>` when it is erased. `--email` or `--handle` instead of `--request` records a new request at the same time. `--now` erases it within minutes instead of after the 14 days. |
| `complete <id> [--refused] [--notes <text>]` | Closes a request once it is answered, or refused. Notes are added to what was noted before. |

Notes are for what was done and why, not for copies of the person's messages:
they are personal data too.

## When a request arrives

1. **Record it the same day.** `record --email <address> --kind <kind>`, with a
   short note of what they asked for. The answer is due 30 days later
   (`PRIVACY_REQUEST_DUE_DAYS`).
2. **Confirm it is them.** Act only on a request sent from the email address
   the account signs in with. The `record` output says whether an account has
   the address. If it came from anywhere else, reply asking them to write again
   from that address, or to use Settings (Download your data, Delete your
   account), which needs them to sign in. Do not ask for an ID document: it is
   not needed and would be more personal data to keep. Someone writing for
   another person (a parent, a lawyer, the family of a member who has died)
   goes to counsel first (C-03).
3. **Do what they asked**, by kind, as below.
4. **Reply, then close it.** `complete <id> --notes "<what was done>"`. If it
   cannot be done (they never confirmed it was them, or what they ask is not
   possible), `complete <id> --refused --notes "<why>"`, and tell them why.

The API warns once a day in its log, by request ID, about requests still open
past their due date. `list --overdue` shows the same.

## By kind

**Access.** Everything HeyNaija holds about a member that it can give them is
in Settings → Download your data, one JSON file. Reply with how to get it. If
they ask about something the download does not hold (server logs, backups,
what other services keep), answer from `/privacy`.

**Correction.** Name, bio, photo, handle and email address are changed in
Settings by the member. For anything else, change it by hand with a second
person checking, and say in the notes what changed.

**Deletion.** Once they have confirmed it is them:
`delete-account --request <id>`. The account leaves the site at once, every
session ends, and the erase follows after 14 days; they are emailed the date
and can keep the account by signing in before then. The request completes
itself when the account is erased; there is no `complete` to run. Use `--now`
only when they ask for it to be erased at once and understand it cannot be
undone. A site moderator can be deleted this way; the erase takes their role.
If the account is already waiting for deletion, the command says so and
changes nothing; close the extra request with `complete <id> --refused --notes
"already deleting"`.

**Objection.** HeyNaija runs no adverts and sells no data. Most objections are
to emails or notifications, which they can turn off in Settings. Anything about
moderation records, or processing they say they never agreed to, goes to
counsel before answering.

**Other.** Answer it, record what was done, close it.

## If an erase does not happen

The API erases due accounts every hour. If one keeps failing (Kratos or storage
unreachable), its log says `gave up erasing member <id>` and tries again a day
later; the account stays off the site meanwhile. Fix the cause; nothing else is
needed. A deletion request still open past its due date shows in
`list --overdue`.
