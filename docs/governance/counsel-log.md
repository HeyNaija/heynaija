# Counsel log: questions for HeyNaija's lawyers

Started 29 October 2026. Everything HeyNaija needs a qualified Nigerian lawyer
to answer, gathered in one place so it can be taken to counsel together. Each
entry states the question, the facts as they are in the service today, what
HeyNaija proposes and what it needs back. Nothing here is legal advice, and a
proposal is not a decision until counsel has answered.

**How the log works**

- A question goes in as soon as the work turns it up, even half-formed. Number
  entries in order and never reuse a number.
- An entry is closed only by counsel's answer: record the date, who answered and
  the answer in brief under **Answer**, then make the public page and the code
  match in the same commit (as [open-items.md](open-items.md) asks).
- Questions already written up elsewhere are not copied here; they are listed,
  with where to find them, under [Recorded elsewhere](#recorded-elsewhere).
- Facts are as of the date raised. "The service" means heynaija.ng, the API and
  its databases.

| No. | Question | Raised | Status |
| --- | --- | --- | --- |
| C-01 | How soon after a request an account must be erased | 29 Oct 2026 | Open |
| C-02 | How long HeyNaija has to answer a request made by email | 29 Oct 2026 | Open |
| C-03 | How to confirm who is asking | 29 Oct 2026 | Open |
| C-04 | Keeping deleted posts as moderation evidence | 29 Oct 2026 | Open |
| C-05 | Moderation records about and by a deleted member | 29 Oct 2026 | Open |
| C-06 | Keeping the record that a deleted member declared they were 18+ | 29 Oct 2026 | Open |
| C-07 | Images taken down or blocked, kept privately | 29 Oct 2026 | Open |
| C-08 | Backups that still hold erased data | 29 Oct 2026 | Open |
| C-09 | The record of privacy requests itself | 29 Oct 2026 | Open |
| C-10 | Suspended members who delete their account and come back | 29 Oct 2026 | Open |
| C-11 | Other members' posts that name a deleted member | 29 Oct 2026 | Open |
| C-12 | Pausing an erasure (legal holds) | 29 Oct 2026 | Open |
| C-13 | Service providers that hold copies | 29 Oct 2026 | Open |
| C-14 | Holding a deleted member's handle for 30 days | 29 Oct 2026 | Open |

## Account deletion and privacy requests

These come from the design in
[ADR 0016](../adr/0016-account-deletion.md), which is being built now; the facts
below describe the service as designed. In short: a member can delete
their account in Settings, or ask by email. The account comes off the site at
once and is erased 14 days later; until then the member can sign in and cancel.
Erasure deletes the sign-in account (email address and sign-in methods) and
deletes or blanks everything personal, but keeps some records as evidence for
moderation. The relevant law is taken to be the Nigeria Data Protection Act 2023
and any NDPC regulation, directive or guidance in force; counsel should correct
that if more applies.

### C-01 How soon after a request an account must be erased

**Question.** Does taking the account off the site at once, and erasing it 14
days later, meet the duty to erase without undue delay? May the grace period be
offered at all, and is 14 days acceptable?

**Facts.** At the request the account is deactivated: the member is signed out
everywhere, their profile and posts leave every page, and nothing is sent to
them. Nothing is erased for 14 days (`ACCOUNT_DELETION_GRACE_DAYS`, which can be
set between 0 and 30). The member can sign in during that time only to cancel,
download their data or sign out. The 14 days guard against someone who has taken
over the account deleting it, and against a deletion regretted at once. They also
give moderators time to decide open reports. HeyNaija can erase at once when
asked by email.

**What we propose.** 14 days, stated on `/privacy` and in the confirmation
email, with erasure at once available on request by email.

**Needed from counsel.** Whether this is lawful as described; the longest grace
period that is; whether the member must be offered erasure at once in the app.

**Answer.** —

### C-02 How long HeyNaija has to answer a request made by email

**Question.** What is the deadline for answering a privacy request (access,
correction, deletion, objection) made by email, and when does it start: on
receipt, or once the person is confirmed as the account holder (C-03)?

**Facts.** Each request is recorded with the date received and a due date,
30 days later by default (`PRIVACY_REQUEST_DUE_DAYS`). Overdue requests are
flagged to the operator. `/privacy#rights` currently says "[period]".

**What we propose.** 30 days from receipt, stated on `/privacy`.

**Needed from counsel.** The deadline and its start; whether it can be extended
and how the person must be told; anything that must be in the reply.

**Answer.** —

### C-03 How to confirm who is asking

**Question.** Is a reply from the email address the account signs in with
enough to act on a request made by email? What should HeyNaija do when it is not
available?

**Facts.** Accounts are passwordless: members sign in with a code sent to their
email address, or with Google. HeyNaija holds no other proof of identity (no
names, ID documents or phone numbers). In the app, deleting needs a sign-in in
the last 15 minutes and typing the account's handle.

**What we propose.** Act on email requests only when confirmed from the
account's address. Where that is impossible (the person has lost access to the
address), ask them to sign in with Google if connected, and otherwise refuse,
recording why.

**Needed from counsel.** Whether this is enough and not excessive; how to handle
requests made for someone else (a parent or guardian, a lawyer, the family of a
member who has died); what to record when a request is refused.

**Answer.** —

### C-04 Keeping deleted posts as moderation evidence

**Question.** May HeyNaija keep the text and images of some of an erased
member's posts as evidence, and for how long?

**Facts.** When an account is erased, the text and images of its posts are
removed, except for posts a moderator took down or that were reported at any
time ("evidence posts"). Those stay, out of public view, so moderation decisions
can be checked, and are blanked after a retention period
(`DELETED_CONTENT_RETENTION_DAYS`), which is not set: until it is, they are kept.
The same period covers posts members delete themselves; `/privacy#keep` already
says these are kept for "[period]".

**What we propose.** The evidence posts as defined above, for a period counsel
sets, after which their text is blanked.

**Needed from counsel.** The lawful basis; the period; whether "reported at any
time" is too wide (for example, a report dismissed as unfounded); whether the
period differs for posts members delete themselves.

**Answer.** —

### C-05 Moderation records about and by a deleted member

**Question.** May HeyNaija keep moderation records after erasure, linked to a
blank placeholder for the account, and for how long?

**Facts.** The account's row stays as a placeholder: its name, bio, photo and
handle are removed, and it shows as `@deleted-` and eight characters of its
internal ID. Kept, and linked to it: reports made about the member and their
posts (with the reporter's own words), the moderators' decisions, a suspension,
and reports and appeals the member made (with their words about other people).
The sign-in account is deleted, so the placeholder can no longer be tied to an
email address, except in backups for up to 30 days (C-08), or through the
content of evidence posts.

**What we propose.** Keep these records for a period counsel sets, on the basis
that they are needed to show moderation was done fairly and to answer appeals,
complaints or claims.

**Needed from counsel.** Whether the placeholder and what is linked to it are
still personal data; the lawful basis; the period; whether reports the member
made should be cut off from the placeholder instead (HeyNaija's view is that this
would hide when one account made many reports, while protecting little).

**Answer.** —

### C-06 Keeping the record that a deleted member declared they were 18+

**Question.** May HeyNaija keep, after erasure, the record that the member
declared they were 18 or older and when, and for how long?

**Facts.** During the beta only adults may join; at sign-up a person ticks "I am
18 or older". The declaration is stored twice: as an age record the service acts
on, and as an entry in an append-only audit trail (no free text, codes only).
`/privacy#keep` says age confirmation is kept "for as long as you have an
account".

**What we propose.** Delete the age record at erasure; keep the audit entry for
a period counsel sets, so HeyNaija can show the 18+ rule was applied if it later
emerges that a child joined. Change `/privacy#keep` to say so.

**Needed from counsel.** The lawful basis and the period; the wording for
`/privacy`. Related: [open-items.md](open-items.md) section 2 asks the lawful
basis and retention for age records in general.

**Answer.** —

### C-07 Images taken down or blocked, kept privately

**Question.** How long may (or must) HeyNaija keep images that moderators took
down, or that the upload scanner blocked, after the account is erased?

**Facts.** Images moderators take down are moved out of public view and kept
privately; `/privacy#keep` says for "[period, to be confirmed by counsel]". An
upload matching known child sexual abuse material is never published and is kept
privately for reporting. Erasure leaves both kept. The questions about the
second kind went to counsel on 26 October 2026
([abuse-material-scanning.md](../safety/abuse-material-scanning.md)).

**Needed from counsel.** The period for each, and whether erasure changes it.

**Answer.** —

### C-08 Backups that still hold erased data

**Question.** Is it acceptable that erased data stays in backups until they age
out, and what must `/privacy` say?

**Facts.** Both databases (the app's and the sign-in service's) are backed up
nightly, encrypted, and each backup is kept 30 days (`BACKUP_KEEP_DAYS`). A
backup cannot be edited, so an erased account remains in backups for up to 30
days. If a backup were ever restored, the operator's restore procedure (to be
written) re-applies every erasure made since it was taken. Images are not backed
up.

**What we propose.** State on `/privacy` that erased data leaves backups within
30 days, and that a restored backup is erased again.

**Needed from counsel.** Whether this is acceptable; the wording.

**Answer.** —

### C-09 The record of privacy requests itself

**Question.** What may HeyNaija keep about the privacy requests it handles, and
for how long?

**Facts.** Each request is recorded: the kind, how it came in, when it was
received, due and completed, which operator handled it, and private notes. After
an erasure the record points at the placeholder (C-05). The notes may contain
personal data (what the person asked, how they were confirmed).

**What we propose.** Keep each record for a period counsel sets, to show
requests were handled on time; tell operators to keep notes to the minimum.

**Needed from counsel.** The period, and any limits on what the notes may hold.

**Answer.** —

### C-10 Suspended members who delete their account and come back

**Question.** May HeyNaija keep anything after erasure that would recognise a
suspended member who rejoins under a new account?

**Facts.** A suspended member may delete their account; the suspension stays on
the placeholder, but erasure deletes the email address. HeyNaija is invite-only,
so a returning member needs a new invite, but nothing would show it is the same
person. A keyed hash of the email address, kept only for suspended members, would
let the service recognise them without keeping the address itself.

**What we propose.** Nothing kept for now; ask before building anything.

**Needed from counsel.** Whether keeping such a hash is lawful, on what basis
and for how long, and what `/privacy` would have to say.

**Answer.** —

### C-11 Other members' posts that name a deleted member

**Question.** How should HeyNaija treat what other members wrote about or to a
deleted member?

**Facts.** Erasure removes the member's own content (C-04 aside). Other
members' posts that mention their handle, replies to their posts and quotes of
them stay: they are the other members' words. The mention no longer links
anywhere, and the erased member's posts show in conversations as no longer
available, without their name. Notices sent to people who reported the member keep naming the
placeholder.

**What we propose.** Keep other members' posts. Handle a request to remove one as
a report, under the rules.

**Needed from counsel.** Whether that balance is right; whether a former member
can require such posts to be removed or changed, and when.

**Answer.** —

### C-12 Pausing an erasure (legal holds)

**Question.** Must HeyNaija be able to pause an erasure, and when?

**Facts.** Nothing pauses an erasure once its date arrives, even if a report
about the member is still open, a complaint or claim is threatened, or the police
ask for data. Open reports are left to the 14-day grace period. Posts and images
already involved in moderation are kept (C-04, C-07), but the member's name and
bio are erased even if they are what was reported.

**What we propose.** No hold for now; build one if counsel says it is needed.

**Needed from counsel.** When HeyNaija may or must delay an erasure (law
enforcement or regulator requests, legal claims, safeguarding), and what it must
then tell the member.

**Answer.** —

### C-13 Service providers that hold copies

**Question.** What must HeyNaija do about copies of a deleted member's data held
by its service providers?

**Facts.** At erasure, images are deleted from storage (Cloudflare R2) and
removed from Cloudflare's cache. Beyond HeyNaija's control: the email
provider's record of messages sent, and Cloudflare's and the servers' logs
(which include IP addresses; `/privacy#keep` says "[period]").

Checked on 29 October 2026: the sign-in service (Ory Kratos, run by HeyNaija
itself) keeps a copy of every email it sends: the address, the subject (which
contains the one-time sign-in code), the account's email and handle at the
time, and the browser's description of itself (User-Agent). It keeps them with
no time limit, for every member, and deleting an account does not remove them.

**What we do now** (since 30 October 2026). The sign-in service's copies of sent
emails are deleted every night once they are 7 days old, for everyone
(`KRATOS_SENT_MAIL_KEEP_DAYS`). A sign-in code is useless after 15 minutes; the
copies help only to trace a delivery problem. An erased member's copies are
therefore gone within a week of the last email, and backups (kept 30 days) never
hold copies older than 7 days.

**Needed from counsel.** What the contracts with these providers must say about
deletion; whether HeyNaija must ask them to delete anything on each erasure;
the period for server logs; whether 7 days for copies of sent emails is right,
and whether an erased member's must instead go at once.

**Answer.** —

### C-14 Holding a deleted member's handle for 30 days

**Question.** May HeyNaija keep a deleted member's handle for 30 days so nobody
else can take it?

**Facts.** When someone renames, their old handle is held for 30 days so nobody
can pick it up and pass themselves off as them (ADR 0004). The same is proposed
after erasure: the handle is kept, linked to the placeholder, and freed after 30
days. During that time nobody, the former member included, can take it.

**What we propose.** As described.

**Needed from counsel.** Confirmation, and whether `/privacy` should mention it.

**Answer.** —

## Recorded elsewhere

Questions already written up, to be taken to counsel with this log:

- [open-items.md](open-items.md), section 1: the operator's name and address
  (the data controller), cross-border transfer safeguards, the retention periods
  shown as placeholders on `/privacy`, and retention of verification results.
- [open-items.md](open-items.md), section 2: whether self-declaration is enough
  age assurance for the 18+ beta; the age model; the mistaken-age procedure;
  members who joined before 16 October 2026; the lawful basis and retention of age
  records; the identity verification person key; the charter notice period; and
  the constitution and nonprofit structure.
- [open-items.md](open-items.md), section 3: the data protection impact
  assessment and other approvals before identity verification may be switched on.
- [legal-review.md](legal-review.md): ten questions on the nonprofit structure
  under CAMA 2020 Part F, for nonprofit counsel.
- [abuse-material-scanning.md](../safety/abuse-material-scanning.md): questions
  on child sexual abuse material, sent to counsel on 26 October 2026, answers
  awaited.
- [under-18-rollout.md](under-18-rollout.md): everything to settle before
  accounts for under-18s.
