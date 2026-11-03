# ADR 0020 — Opening HeyNaija to under-18s: date of birth at signup and 18+ labels, in two phases

**Date:** 3 November 2026 · **Status:** Proposed, design only. Nothing is built:
no schema, no migration, no endpoint, no UI. · **Roadmap:** `adult-content-labels`
(phase 1), `minor-safeguards` (phase 2) · **Related:**
[ADR 0006](0006-age-status-model.md), [ADR 0016](0016-direct-messages.md),
[ADR 0016](0016-account-deletion.md) (account deletion), ADR 0018 (age
verification, PR #61), ADR 0019 (video posts, PR #63),
`docs/governance/under-18-rollout.md`, `docs/feature-flags.md`

Nothing here is legal advice. Every legal point is for Nigerian counsel (section 7).
This ADR takes the requirements in `docs/governance/under-18-rollout.md` as
given and orders them; it does not repeat that checklist.

## Decision (recommended)

**Owner decision, 3 November 2026:** the 18+ beta rule is to be taken out, so that
people from 13 can join (question 1). Signup asks for a date of birth, and posts
(with their media) carry an 18+ label set by the poster, which keeps that content
from anyone not known to be an adult.

This ADR does that in two phases, so the parts that do not involve children's data
ship first and are proven before any minor arrives:

- **Phase 1, with the 18+ rule kept.** A date of birth at signup in place of the
  "I am 18 or older" tick, kept with the age record (question 5 gives the
  reasons). An 18+ label on posts and
  communities, enforced on the server in every read path, with labelled media
  served privately. Members whose age is not on record are asked for it. Under-18s
  are still refused, so no child's data is processed.
- **Phase 2, opening to minors.** Only after counsel has answered section 7, the
  rest of the under-18 rollout checklist is built and tested, and a named person
  has signed off: minors from 13 get `under_18` accounts with the
  protections in section 4, and `UNDER_18_ACCOUNTS_ENABLED` is changed in review.

A date of birth is the member's own word, so it gives `declared`, never `verified`.
It is enough for 18+ content (`age_restricted_content` accepts `declared` today,
ADR 0006) unless counsel says otherwise (section 7, item 2). It never opens direct
messages, calls or Gists, which need the check in ADR 0018, and never counts for
`governance_vote`.

## Context

- **What exists.** `restricted.age_assurances` holds an age band (`under_18`,
  `18_plus`), how it was established, when, `review_after` for minors, and
  withdrawal. `ageStatus()` picks the strongest live statement and
  `isAdultFor(status, 'age_restricted_content')` is the adult test for content;
  nothing calls it yet, because nothing is labelled (ADR 0006, Consequences).
  `signupAgeDecision()` refuses anyone who has not ticked 18+, and
  `UNDER_18_ACCOUNTS_ENABLED` is locked off in `apps/api/src/env.ts`.
- **The model the owner set on 16 October 2026** (under-18 rollout doc): social
  networking open to eligible under-18s with consent and safeguards; adult content
  kept from minors; voting stays 18+ and verified; unknown age is never adult.
  `/rules#age` already tells members the 18+ rule is temporary.
- **Who is not an adult today.** Under-18s cannot sign up, so the only viewers who
  fail `isAdultFor` are signed-out visitors and members from before 16 October 2026
  with no age on record (`unknown`). Phase 1's enforcement is exercised by them
  before any minor exists.
- **Every post is public**, signed out included (`visibleAuthor` in
  `apps/api/src/posts/posts.service.ts` takes a null viewer). Post images, GIFs and
  community photos are served from the public `heynaija-media` bucket under
  `/media`, cached for a year (`docs/deployment/cloudflare-r2.md`); ADR 0019 serves
  video renditions from the same custom domain. That URL bypasses the API.
- **What the documents promise today.** `/join` ("We don't ask for your date of
  birth or any ID"), `/privacy` (three places), the under-18 rollout doc section 2
  ("never a full birth date, unless counsel says a birth date is necessary") and
  the draft constitution Articles 3.2 and 4.3 (no soliciting birth dates "without a
  separately approved essential-purpose design"). Section 6 lists what changes.

## 1. Date of birth at signup (phase 1)

- **The form.** `/join` replaces the tick with a date of birth (day, month, year).
  It is still only the person's word, but a child has to make up a date instead of
  ticking the box the form asks for.
- **The band, worked out on the server.** The `/join` server action
  (`acceptInvite`) works out the age on the day, in Lagos time, only to refuse
  early (below). If the date passes, the existing `hn_age` cookie carries it in
  place of `18-plus` (httpOnly, for up to an hour, as today), and
  `infra/kratos/invite-check.jsonnet` passes it to the registration webhook as
  `birth_date` in place of `adult_declared`. The API works the age out again
  (`signupAgeDecision`) instead of trusting the web app, and
  `recordAgeDeclaration` writes a `self_declared` row with the band and the date.
  In phase 1 the band is always `18_plus`; in phase 2 a minor's row also gets
  `review_after`, their 18th birthday. For one release the webhook also accepts
  `adult_declared`, so signups in flight across the deploy still work.
- **The date is kept, with the age record** (question 5 gives the reasons).
  `restricted.age_assurances` gains `birth_date` (a date, nullable), set only on a
  `self_declared` row made from a date of birth. Rows from the old tick have none.
  - The rules still read only the band, so `ageStatus()` and `isAdultFor()` do not
    change. If an age in the rules changes (counsel's age of a child, the minimum
    age, or separate protections for 13 to 15), new rows are worked out from the
    dates already given and the old ones are withdrawn.
  - Only the member sees it: in Settings next to their age status, and in the data
    export. Moderators don't; they see minor or adult only (rollout doc section 6).
    Nor do the admin pages, profiles or any public API.
  - Not logged, not in error reports or analytics, never a Kratos trait, and not
    echoed back into the form after a refusal. The `hn_age` cookie is cleared when
    signup finishes.
  - Given once. A member cannot change it themselves. A correction goes through
    support (contact@heynaija.ng) and is a new row, with the old one withdrawn, so
    nobody can try dates until one gets past the limit.
  - Deleted with the account: ADR 0016's account deletion already deletes the age
    rows.
  - In phase 1 only a date that gives 18 or older is kept. A refused signup keeps
    nothing, and an existing member's under-18 date is not kept (below), so no
    child's data is held before phase 2.
- **Below the age limit.** In phase 1 that is anyone under 18; in phase 2, anyone
  under 13 (question 1). Refused with a kind message, keeping no age
  record (rollout doc section 2). The refusal is held for a day in a cookie that
  says only "refused", so changing the year and sending again does not work
  straight away; that stops only the laziest retry and is not a control.
  Impossible dates (in the future, or more than 120 years ago) are refused as
  typing mistakes.
- **Members with no age on record.** Asked once for a date of birth, by a prompt
  on their next visit and in place of any 18+ item they try to open; until they
  answer they are not adult (already how `isAdultFor` works). The rollout doc
  requires every unknown age to be asked before any minor joins, so phase 2 waits
  for this. One whose date gives under 18 is not refused like a signup, because the
  account exists in an 18+ beta: an operator alert opens the mistaken-age process
  in `/rules#age`, the date is not stored, and they stay `unknown` until a
  moderator acts. Members who already ticked "18 or older" are not asked again
  (question 6).
- **No flag.** It replaces one field and ships through staging like any change.
  The e2e `submitSignUp` helper (`e2e/lib/members.ts`) ticks the box today and must
  type a date. `signUpOverHttp` and `newMember` set `hn_age` to `18-plus` directly
  and must set a date instead.

## 2. The 18+ label (phase 1)

**What can carry it.** A post, with everything attached to it (images, GIFs, video,
a poll, a link preview), and a whole community. A reply can be labelled on its own.
Profile photos, display names, bios, community photos, names and descriptions,
ideas and Gist titles cannot be labelled, so 18+ material is not allowed in them at
all. What needs the label and what is not allowed anywhere is a rules question
(question 3).

**Who sets it.**
- The poster, with a "Mark as 18+" switch in the composer and later from the post's
  menu.
- A community's moderators, for the whole community (question 8); every post in a
  labelled community counts as labelled.
- A moderator, on any post, from the moderation queue or the post. It is logged
  with the other moderation actions, the author gets a notice, and the existing
  appeal applies. The author cannot remove a label a moderator added.
- Anyone can report a post with a new reason, "Should be marked 18+"
  (`REPORT_REASONS` gains `needs_label`). Repeated mislabelling is a rules breach.

**Data.** `posts.adult_label` (`null`, `author` or `moderator`) and
`communities.adult_only` (boolean). A member setting for how labelled content is
shown to them (question 4). No other new column.

**Flag.** A database flag `adultLabels` gates making labels: the composer switch,
the moderator action and the report reason. Enforcement never depends on it.
Turning the flag off must not show labelled posts to anyone who could not see them
before (`docs/feature-flags.md`: gate creation, not existing data).

## 3. Enforcement (phase 1)

**One test of the viewer.** `seesAdultContent(viewer)` is true only for a
signed-in member for whom `isAdultFor(ageStatus, 'age_restricted_content')` holds.
It is synchronous, and the age status is loaded once per request where the member
is loaded, as ADR 0018 does for `isAgeVerifiedAdult`. Signed out, `unknown` and
`under_18` are always false.

**One condition on posts.** A shared SQL condition beside `visibleAuthor`, and used
everywhere it is: a post is shown only if it is unlabelled, its community is not
adult-only, and its parent is not hidden; or the viewer `seesAdultContent`. On top
of the places `visibleAuthor` already covers (feeds, threads, replies, quoted and
reposted posts, profiles), it must cover:
- search, hashtag and topic pages, Discover and trending;
- community pages, pinned posts, and joining or listing an adult-only community;
- notifications (`visible` in `notifications.service.ts`), push and email bodies;
- link previews: `/p/[id]`'s `generateMetadata` gives no text or image for a
  labelled post, because previews are fetched signed out;
- the data export, for other people's posts.

A test lists every route that returns posts and checks that a labelled post, and a
reply under it, never reaches a signed-out viewer or an `unknown` member. A new
read path that is missing from the list fails it.

**What a viewer who cannot see it gets.** In a thread, a placeholder, so the
conversation still makes sense: signed out, "This post is marked 18+. Sign in to
see it."; `unknown`, "Add your date of birth to see posts marked 18+."; and in
phase 2, for a minor, "This post isn't available", with no hint of why. Elsewhere it
is left out.

**Adults** see labelled posts behind a "Marked 18+" cover, tap to show, built like
the low-data hold (`media-held` in `apps/web/app/ui/post-images.tsx`), with a
Settings switch to show them straight away (question 4).

**Media.** Labelled media is not served from the public bucket: it is kept in a
private location and served to allowed viewers by short-lived signed URLs. A label
added after posting moves the files and purges the CDN, as moderator removal
already does (`apps/api/src/media/cdn-purge.ts`). Video (PR #70) follows the same
rule. This is required before phase 2 (rollout doc section 4) and is cheaper built
once now, while video's serving is still being designed. The unguessable public URL
is not a control: anyone allowed to see it can share it.

## 4. Opening to minors (phase 2)

Starts only when every item in section 5 is met. What changes for an `under_18`
member, from the rollout doc and ADR 0019, with phase 1 already in place:

- **Age.** A `self_declared` `under_18` row with their date of birth and
  `review_after` set to their 18th birthday. When it passes, they are asked to
  confirm they are now 18, which writes a fresh `18_plus` statement; nothing moves
  them silently.
- **Guardian consent.** Not asked for, for now (question 2). If counsel's answer
  to section 7 item 1 says 13 to 17 need it, phase 2 also waits for the separate
  consent record in rollout doc section 3, and an account stays pending until
  consent is complete.
- **Content.** No 18+ posts or adult-only communities, anywhere (section 3). A
  minor cannot set the label; a minor's post that needs it is removed, not
  labelled.
- **Contact.** No direct messages, calls or Gists (ADR 0016, 0017, 0018). Replies
  limited to people they follow, and mentions from strangers limited, by default.
  Not suggested to adults and left out of member search. Minimal profile: no age
  band, no location, no follower lists to strangers.
- **Visibility** of minors' own posts: question 7.
- **Video.** Minors cannot post video (ADR 0019, section 4.6).
- **Governance.** Never voting members.

## 5. What phase 2 waits for

1. Counsel's answers to section 7, with question 2 revisited if the answer on
   consent requires it. Questions 1, 2 and 7 are answered.
2. Phase 1 live in production: dates of birth at signup, every `unknown` member
   asked, labels enforced and the read-path test passing, labelled media private.
3. Hash-matching of known abuse material on every upload (PhotoDNA or equivalent,
   `docs/safety/abuse-material-scanning.md`). Today no scanner is bound; this is the
   same blocker as ADR 0019's launch gate.
4. The rest of `docs/governance/under-18-rollout.md` ticked: sections 3 (consent,
   if required), 5 (contact), 6 (child-safety reporting, trained moderators, an
   escalation route) and 7 (privacy policy rewritten for children with a version a
   child can understand, rules and Terms, the draft constitution's youth decision
   through the governance process, a security review, and e2e tests for minor
   signup, consent, content restriction and contact limits).
5. A named person signs off in writing (question 9). Only then is
   `UNDER_18_ACCOUNTS_ENABLED` changed in `env.ts`, in review, and the `/join` age
   question and `infra/kratos/invite-check.jsonnet` extended for the minor band.

## 6. Copy and documents that change

Phase 1, in the same changes as the code:
- `/join`: the hint "We don't ask for your date of birth or any ID."
- `/privacy`: "Your age confirmation" ("We do not ask for your date of birth"), the
  identity section ("does not collect … dates of birth"), and the cookie list
  (`hn_age` now carries the date for up to an hour; the new refusal cookie). Say
  that we ask for the date at signup and keep it with the age record, why (question
  5), that only the member sees it, and that it is deleted with the account.
- ADR 0006 decision 5 ("never a birth date"): on acceptance, a note that a stated
  date of birth is now kept (this ADR). No exact age or document is kept, and the
  rules still read only the band.
- `/rules`: what must be marked 18+, what is not allowed at all, and that
  mislabelling is a breach (question 3).
- `docs/governance/under-18-rollout.md` section 2, first item: it says to derive the
  band and not keep the date. By owner decision this asks for a date and keeps it
  (question 5); record that there, with counsel's answer (section 7, item 3) when it
  comes.
- The draft constitution, Article 3.2 (extra age data needs "a documented purpose,
  lawful basis, safeguards and retention schedule") and Article 4.3. This ADR is
  meant to be that design:
  - the purpose is applying the age limit at signup, keeping 18+ content from
    minors, and the reasons in question 5;
  - the basis is section 7 item 3;
  - the safeguards are in section 1 (the restricted schema, only the member sees it,
    never logged, given once);
  - the retention is the life of the account.

  It counts only once accepted.

Phase 2: `/rules#age` (the 18+ rule and the mistaken-age process, rewritten for a
world with minors), `/privacy` for children's data, Terms, and ADR 0019 section 4.6
("All accounts are 18 or over today").

## 7. What a lawyer should confirm

1. The age of a child for consent to processing under the NDPA and the GAID (13 or
   18; ADR 0018 found the sources conflict), and so whether 13 to 17 need a parent's
   or guardian's consent, and how that consent must be confirmed.
2. Whether a typed date of birth is "appropriate age verification" for keeping 18+
   content from minors, or whether that needs a check (ADR 0018).
3. Whether asking every new member for a date of birth and keeping it (question 5)
   is lawful and in proportion under the NDPA's data minimisation principle, what
   notice it needs on `/privacy`, and whether it meets the rollout doc's "unless
   counsel says a birth date is necessary".
4. What 18+ content may lawfully be hosted at all, and what extra duties hosting it
   brings once minors are members (including the NITDA Code of Practice).
5. Minors living outside Nigeria: whether their country's law (for example the UK
   Online Safety Act or the EU Digital Services Act) adds duties, or whether
   phase 2 should be Nigeria-only.
6. What a guardian may see and do with a child's data (access, export, deletion),
   balanced against the child's own privacy.

## Consequences

- New members give a date of birth, and HeyNaija keeps it. A later check can be
  compared with it, and bands can be worked out again if an age in the rules
  changes (question 5). The cost is a birthday for every new member, a detail
  fraudsters use to answer identity questions, so a leak of the restricted schema
  is worth more than before.
- Phase 1 changes what signed-out visitors see: labelled posts become placeholders,
  and links to them preview as nothing.
- Every new read path must use the shared condition; the read-path test is what
  stops a leak.
- Labelled media costs more to serve (signed, short-lived URLs cache less), for a
  small share of posts.
- Labels rely on posters first; reports and moderators are the net. A child who
  types a false date sees 18+ content until reported; a check (ADR 0018) is the only
  stronger answer, and counsel decides whether it is needed.
- Phase 2 is a large build gated on counsel, scanning and moderation capacity, not
  on this ADR.

## Open questions

### Questions for the team to answer

Answer under each question (edit this file in a PR, or reply on the PR and the
answer gets written back here). Each has a recommendation, so "agreed" is a complete
answer. All nine are answered, so phase 1 can start once this ADR is accepted.

1. **What is the minimum age?** Recommendation: 13, subject to counsel (section 7,
   item 1); nobody under it, ever.
   - Answer: Yes, 13.
   - Answered by / date: Psami-wondah, 3 November 2026

2. **Do 13 to 17 year olds need a guardian's consent?** Recommendation: follow
   counsel. If yes, phase 2 includes the consent record in rollout doc section 3,
   and an account stays pending until consent is complete.
   - Answer: No, not for now. Revisit if counsel's answer to section 7 item 1 says
     the law requires it; phase 2 waits for that answer anyway (section 5).
   - Answered by / date: Psami-wondah, 3 November 2026

3. **What must be marked 18+, and what is not allowed at all?** Recommendation: not
   allowed anywhere: explicit sexual images or video, and anything already illegal.
   Marked 18+: graphic violence or injury (news footage included), non-sexual nudity,
   sexual talk without explicit images. When in doubt, mark it.
   - Answer: Agreed.
   - Answered by / date: Psami-wondah, 3 November 2026

4. **How do adults see labelled posts?** Recommendation: behind a "Marked 18+" cover,
   tap to show, with a Settings switch to show them straight away.
   - Answer: Agreed.
   - Answered by / date: Psami-wondah, 3 November 2026

5. **Keep the date of birth, or only the age band it gives?** The band is the age
   group, `under_18` or `18_plus`, the only two values `age_assurances` holds.
   Keeping only the band means the database records "18 or older, stated at signup
   on 3 November 2026", never the birthday itself. For a minor it also keeps the
   month they turn 18 (`review_after`), so they can be asked to confirm then.
   Keeping the date would let a later provider result be compared with it.
   Recommendation: only the band, plus `review_after` for a minor. Content needs
   nothing more, ADR 0006 and `/privacy` promise it, and the rollout doc says not to
   keep the date.
   - Answer: Keep the date of birth, with the safeguards in section 1. Why:
     - **The ages may change, and asking again doesn't work.** Counsel may set the
       age of a child at 18 rather than 13, the minimum age may move, or 13 to 15
       may need different protections from 16 to 17 (rollout doc section 1). With
       the dates kept, bands are worked out again from what members already said.
       With only the band, everyone would have to be asked again, after the
       thresholds are known, so the answers would be worth less.
     - **A later check has something to be compared with.** ADR 0018's provider
       result, an appeal, or the mistaken-age process can be set against the exact
       date the member gave, not only a band.
     - **Minors' protections change on the right day.** A minor's 18th birthday
       (and 16th, if protections differ) is known exactly, not rounded up to a
       month.
     - **The member's own statement is on record.** If a regulator or a parent asks
       what someone said about their age, the answer is the date they gave and
       when.
   - Answered by / date: Psami-wondah, 3 November 2026

6. **Who is asked for a date of birth?** Recommendation: every new signup, and every
   member with no age on record; members who already ticked "18 or older" are not
   asked again, because a second statement at the same level (`declared`) adds
   nothing.
   - Answer: Agreed.
   - Answered by / date: Psami-wondah, 3 November 2026

7. **Are minors' posts public?** Recommendation: shown to signed-in members only,
   never to signed-out visitors or search engines, with replies limited to people
   they follow by default.
   - Answer: Agreed.
   - Answered by / date: Psami-wondah, 3 November 2026

8. **Can a whole community be marked 18+?** Recommendation: yes, by its moderators
   or a site moderator; every post in it counts as labelled, and minors cannot see
   or join it.
   - Answer: Agreed.
   - Answered by / date: Psami-wondah, 3 November 2026

9. **Who signs off phase 2?** Phase 2 is the step that lets children in, and it
   rests on work spread across counsel, scanning, moderation and code. The sign-off
   is the dated record that someone accountable checked every item in section 5
   before that happened, as ADR 0019 does for video's launch gate. Recommendation:
   a named person, in writing, after section 5 items 1 to 4 are met; the change to
   `UNDER_18_ACCOUNTS_ENABLED` is reviewed like any locked-off setting.
   - Answer: Psami-wondah.
   - Answered by / date: Psami-wondah, 3 November 2026

### Smaller open items

- **Gists.** Gist titles cannot be labelled; a live room for adults only is out of
  scope until Gists leave the allow-list beta (the `gists` flag's list).
- **Retention of `needs_label` reports** follows the other report reasons.
- **A stated date that a check contradicts.** How it is handled belongs in ADR 0018
  (PR #61). It is a reason for review, never an automatic change.
