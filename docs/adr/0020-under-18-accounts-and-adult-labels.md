# ADR 0020 — Opening HeyNaija to under-18s: date of birth at signup and 18+ labels, in two phases

**Date:** 3 November 2026 · **Status:** Accepted, 6 November 2026 (owner). Section
1 is built: the date of birth at signup (PR #102) and asking everyone already here
for theirs (PR #103). The label on posts and its enforcement (sections 2 and 3,
as changed on 7 November below) are built (PR #110), with the apps, and
labelled media is served privately ([ADR 0025](0025-private-sensitive-media.md));
whole communities marked for adults are not yet. Of phase 2, section 4's contact
and discovery protections are built on branch `feat/under-18-contact` (questions
12 to 15), and question 7's limit on who sees minors' posts on branch
`feat/minor-posts-signed-in-only`; the rest is not. ·
**Roadmap:** `adult-content-labels`
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
  served privately. Everyone already on HeyNaija is asked for their date of birth
  too, and cannot use the app until they give it. Under-18s are still refused at
  signup; a member already here whose date gives under 18 is kept as a minor, and
  moderators are told.
- **Phase 2, opening to minors.** Only after counsel has answered section 7, the
  rest of the under-18 rollout checklist is built and tested, and a named person
  has signed off: minors from 13 get `under_18` accounts with the
  protections in section 4, and `UNDER_18_ACCOUNTS_ENABLED` is changed in review.

A date of birth is the member's own word, so it gives `declared`, never `verified`.
It is enough for 18+ content (`age_restricted_content` accepts `declared` today,
ADR 0006) unless counsel says otherwise (section 7, item 2). It also lets a member
host and speak in Gists when their date gives 18 or over (decisions of 5 and 6
November, below). It never opens direct messages or calls, which wait for the
check in ADR 0018, and never counts for `governance_vote`.

**Owner decisions, 5 and 6 November 2026:**

- **13 is the minimum everywhere:** on the web and in the app stores, whose
  listings are rated 13+ (question 1). A store rating keeps nobody out, so signup
  refuses anyone under 13 on every platform, the web included.
- **Signup asks for the date of birth and a confirmation that it is true** (section
  1). It is recorded as what it is, the member's word (`self_declared`, assurance
  `declared`), and never shown or treated as an ID check.
- **The stated age is what the age gates read, until an age check exists:** 18+
  content, and hosting and speaking in Gists, for members whose date gives 18 or
  over. Under-18 and unknown ages can listen to a Gist but never host, co-host or
  take the microphone (6 November, after how X runs Spaces). Governance voting
  still needs an ID-verified age (`governance_vote: 'verified'`).
- **No direct messages or calls until the ID check exists** (6 November): neither
  is built before ADR 0018's check, and both then need it. A stated age is never
  enough for them.
- **Everyone gives a date of birth** (6 November, changing question 6): members
  who ticked "18 or older" are asked too, and nobody can use the app until they
  answer. The age is worked out from the date on every check, so nobody's age
  goes out of date. A member already here whose date gives 13 to 17 is kept and
  treated as a minor at once, and moderators are told; under 13, the account is
  also suspended until a moderator looks.
- **The beta opens to 13 to 17 year olds the way X does** (question 10, 6
  November): with section 4's protections on by default, without waiting for the
  rest of section 5. Upload hash-matching is built: Arachnid Shield.

**Owner decision, 7 November 2026: subtle, the way X does it.** "Don't want to be
scrolling and seeing 18+ on posts. Most things should be happening in the
background." This changes question 4 and parts of sections 2 and 3:

- **No "18+" anywhere in a feed.** The word people see is "sensitive", as on X. The
  label is still the 18+ label underneath (`posts.adult_label`): who may see it is
  decided by age, as before.
- **Only pictures and video are covered**, blurred behind one line, "Sensitive
  content", and a Show button. The words of a post are never covered, and a post
  with no media looks like any other. An adult can switch the cover off in Settings
  ("Show sensitive pictures and video"; off by default, as on X).
- **Marking happens mostly in the background.** The composer offers a small "Mark as
  sensitive" switch only once pictures or a video are attached (X's flag on media).
  Settings can mark everything a member posts (X's "mark media you post as
  sensitive"), so someone who often posts such things never has to think about it,
  and a moderator's mark, on a post or (later) on an account, stays. The post's
  menu can add or take off the author's own mark afterwards.
- **Nothing says why a post is missing.** Signed out, no date of birth and under 18
  never get a marked post: it is left out of lists, and where a conversation needs
  a stand-in (an ancestor, a reply with replies under it, a quote, a reply's
  preview) it is the same placeholder as for a deleted post. No "Sign in to see it".
- **Kept out of what is recommended.** Marked posts never trend and Discover never
  ranks them, for anyone; adults find them through people they follow, profiles,
  communities, search and hashtags.

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

- **The form.** `/join` replaces the tick with a date of birth (day, month, year)
  and a tick confirming it, "This is my real date of birth" (owner decision, 5
  November 2026); signup cannot go ahead without both. It is still only the
  person's word, but a child has to make up a date and confirm it instead of
  ticking the box the form asks for. The confirmation is not stored on its own: a
  `self_declared` row made from a date exists only if it was given.
- **The band, worked out on the server.** The `/join` server action
  (`acceptInvite`) asks the API (`POST /v1/signup/age`, which answers and forgets
  the date) only to refuse early (below), so the age rules stay in one place and
  the web app need not know whether under-18 accounts are open. Ages are worked
  out on the day, in Lagos time. If the date passes, the existing `hn_age` cookie
  carries it in place of `18-plus` (httpOnly, for up to an hour, as today), and
  `infra/kratos/invite-check.jsonnet` passes it to the registration webhook as
  `birth_date` in place of `adult_declared`. The API works the age out again
  (`signupAgeDecision`) instead of trusting the web app, and
  `recordAgeDeclaration` writes a `self_declared` row with the band and the date.
  The stored band is only what the date gave that day: the rules work the band
  out from the date on every check (`ageStatus`), so a minor is an adult from
  the start of their 18th birthday in Lagos, with no new row and no
  `review_after`. The webhook accepted `adult_declared` for one release after
  the date shipped; it no longer does.
- **The date is kept, with the age record** (question 5 gives the reasons).
  `restricted.age_assurances` gains `birth_date` (a date, nullable), set only on a
  `self_declared` row made from a date of birth. Rows from the old tick have none.
  - `ageStatus()` works the band out from the date each time, and `isAdultFor()`
    reads that band. If an age in the rules changes (counsel's age of a child, the
    minimum age, or separate protections for 13 to 15), the dates already given
    answer it, and nobody is asked again.
  - Only the member sees it: in Settings next to their age status, and in the data
    export. Moderators don't; they see minor or adult only (rollout doc section 6).
    Nor do the admin pages, profiles or any public API.
  - Not logged, not in error reports or analytics, never a Kratos trait, and not
    echoed back into the form after a refusal. The `hn_age` cookie is cleared when
    the newcomer finishes or skips the welcome flow, and lasts an hour at most.
  - Given once. A member cannot change it themselves. A correction goes through
    support (contact@heynaija.ng) and is a new row, with the old one withdrawn, so
    nobody can try dates until one gets past the limit.
  - Deleted with the account: ADR 0016's account deletion already deletes the age
    rows.
  - A refused signup keeps nothing. A member already here keeps the date they give
    whatever it says (below), so a child already on HeyNaija is protected as one
    at once (owner decision, 6 November 2026).
- **Below the age limit.** In phase 1 that is anyone under 18; in phase 2, anyone
  under 13 (question 1). Refused with a kind message, keeping no age
  record (rollout doc section 2). The refusal is held for a day in a cookie that
  says only "refused", so changing the year and sending again does not work
  straight away; that stops only the laziest retry and is not a control.
  Impossible dates (in the future, or more than 120 years ago) are refused as
  typing mistakes.
- **Everyone already on HeyNaija** (owner decision, 6 November 2026, changing
  question 6): members with no age on record and members who ticked "18 or older"
  alike. Every page of the app sends them to `/birth-date` (the main layout reads
  `birthDateNeeded` from `/v1/me`), with the same fields and tick as `/join` and a
  Sign out link, and nothing else, until they answer (`POST /v1/me/birth-date`,
  given once, rate limited). The old tick counts for nothing (`ageStatus` ignores a
  `self_declared` row without a date) and is withdrawn when the date arrives. The
  rollout doc requires every unknown age to be asked before any minor joins, so
  phase 2 waits for this.
  - An under-18 date is not refused like a signup, because the account exists in
    an 18+ beta. It is kept, so the rules treat them as a minor at once, and a
    safety alert (`SAFETY_ALERT_EMAIL`, with the handle and never the date) tells
    moderators to follow the mistaken-age process in `/rules#age`.
  - Under 13, the account is also suspended until a moderator looks, recorded in
    the restricted audit trail (`age_below_minimum`) and not in the public
    moderation log. A moderator reinstates it like any suspension.
  - The gate is the web app's. The API does not refuse other requests from a
    member without a date, but every age rule there already treats a missing
    date as not adult.
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

**What a viewer who cannot see it gets.** In a thread, the placeholder a deleted post
gets ("This post is no longer available"), so the conversation still makes sense,
with no hint of why, for everyone who may not see it (7 November). Elsewhere it is
left out.

**Adults** see labelled posts as any other, with their pictures and video blurred
behind "Sensitive content" and a Show button (`MediaCover` in
`apps/web/app/ui/media-cover.tsx`), and a Settings switch to show them straight away
(question 4, as changed on 7 November). Their own posts are never covered.

**Media.** Labelled media is not served from the public bucket: it is kept in a
private location and served to allowed viewers by short-lived signed URLs. A label
added after posting moves the files and purges the CDN, as moderator removal
already does (`apps/api/src/media/cdn-purge.ts`). Video (PR #70) follows the same
rule. This is required before phase 2 (rollout doc section 4) and is cheaper built
once now, while video's serving is still being designed. The unguessable public URL
is not a control: anyone allowed to see it can share it. How, video included:
[ADR 0025](0025-private-sensitive-media.md).

## 4. Opening to minors (phase 2)

Starts when what section 5 still asks for first is met (question 10). What changes
for an `under_18` member, from the rollout doc and ADR 0019, with phase 1 already in
place:

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
- **Contact.** No direct messages or calls (ADR 0016, 0017, 0018). In Gists, a
  listener only: never host, co-host or speaker, and the host cannot hand them the
  microphone (6 November); built: `gist_stage` in `apps/api/src/governance/age.ts`.
  Replies limited to people they follow, and mentions from strangers limited, by
  default. Not suggested to adults and left out of member search. Minimal profile:
  no age band, no location, no follower lists to strangers.
- **Visibility** of minors' own posts: signed-in members only (question 7,
  reaffirmed 7 November); built, below.
- **Video.** Minors cannot post video (ADR 0019, section 4.6). Built: `video_posting`.
- **Governance.** Never voting members.

**Contact, as built** (questions 12 to 15, `apps/api/src/governance/minors.ts`,
tested in `minors.test.ts`), the way X keeps a minor's account to the people they
chose: a minor's circle is the people they follow, and everyone else is a
stranger, whatever the stranger's own age.
- *Replies.* A conversation a minor starts is limited to people they follow
  (`replyAudience` "following", from the existing reply controls); asking for
  "everyone" gets "following", and their posts from before they were known to be
  minors read the same way. They can narrow it to people they mention. Replying
  straight to anything a minor wrote, in anyone's conversation, needs them to
  follow you or to have mentioned you there; the rest of that conversation stays
  as its author set it.
- *Mentions.* A stranger's @handle for a minor is plain text, as for a handle
  nobody has: not linked, not recorded, and no notification. The post still goes
  up, so nothing tells the writer the account is a minor's.
- *Discovery.* A minor is in no one's Discover, member search, @mention
  suggestions or welcome-flow suggestions except their own circle's, and never a
  signed-out visitor's.
- *Profile.* A profile has no age band, no location and no lists of followers or
  followings, for anyone; the counts stay, as on X. A test pins the profile's
  fields, so adding one is a decision here first.
- *Not loosened.* A minor cannot loosen any of this before 18 (question 13); the
  apps are told which reply choices a member has (`replyAudiences` on `/v1/me`).
- *Unknown ages.* These follow the age the rules work out. A member with no date
  of birth yet is not treated as a minor, since that would hide every member who
  has not answered yet, and they cannot use the app until they do. No protection
  here asks whether a viewer is an adult, so an unknown age never counts as one.

**Visibility, as built** (question 7, `reachesViewer` in
`apps/api/src/governance/minors.ts`, tested per read path in
`apps/api/src/posts/minor-posts.test.ts`): a minor's posts reach any signed-in
member, whatever their age, and never a signed-out visitor, which takes in search
engines and link previews. The check sits beside the 18+ label's in one condition
on posts (`postAllowed`, beside `visibleAuthor` in `posts.service.ts`), so every
read path that keeps a marked post from a viewer keeps a minor's from a signed-out
one in the same way.
- *Missing, never "a minor's".* To a signed-out visitor a minor's post is what a
  deleted one is: left out of lists, search, hashtag and community pages, trending
  and the ideas board, and where a conversation needs a stand-in (an ancestor, a
  reply with replies under it, a quote, a reply's preview) the same placeholder.
  Its page is not found, and a link to it previews as nothing.
- *Reposts and poll votes.* A signed-out visitor is shown neither; a poll's counts
  still include a minor's vote.
- *Profile.* Still found signed out, as any member's is, with no age band (section
  4, Contact), but counting no posts and listing none. A profile with no posts to
  show is kept out of search (`noindex`), whoever it belongs to, so a minor's looks
  like anyone's who has not posted yet; a missing post's page is kept out too.
- *Not covered.* A picture's or video's address, which a member can copy, is as
  public as any unmarked post's: the files are not served privately the way
  marked media is (ADR 0025). Trending topics count a minor's hashtags; they show
  a tag and counts, never a post.

## 5. What phase 2 waits for

**Owner decision, 6 November 2026 (question 10):** minors join the way X lets 13
to 17 year olds in, so phase 2 no longer waits for this whole list. What still comes
first is what minors' accounts themselves rest on: dates of birth at signup and
labels enforced (item 2), Arachnid Shield on in production (item 3), and the
protections in section 4. Counsel's answers (item 1) are still asked for; if they
require a guardian's consent, it is added then (question 2). The rest of item 4
follows during the beta.

1. Counsel's answers to section 7, with question 2 revisited if the answer on
   consent requires it. Questions 1, 2 and 7 are answered.
2. Phase 1 live in production: dates of birth at signup, every member already
   here asked, labels enforced and the read-path test passing, labelled media private.
3. Hash-matching of known abuse material on every upload (PhotoDNA or equivalent,
   `docs/safety/abuse-material-scanning.md`). Built: Arachnid Shield scans every
   image and video before it is published, once `ARACHNID_SHIELD_USERNAME` and
   `ARACHNID_SHIELD_PASSWORD` are set (`apps/api/src/media/scanners.ts`). Met when
   they are set in production; this is the same gate as ADR 0019's launch.
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
- Gists rest on a typed date too (decisions of 5 and 6 November). An adult who
  types a date under 18 is only a listener, but a minor who types an adult date can
  host and speak. Reports, blocking and the host's controls are the net. Private
  contact (direct messages, calls) waits for the check, so a typed date never opens
  it.
- Minors join before counsel has answered (question 10). If the age of a child for
  consent turns out to be 18, members aged 13 to 17 by then need a guardian's
  consent after the fact, or their accounts are restricted until they have it.
- Phase 2 is a large build gated on counsel, scanning and moderation capacity, not
  on this ADR.

## Open questions

### Questions for the team to answer

Answer under each question (edit this file in a PR, or reply on the PR and the
answer gets written back here). Each has a recommendation, so "agreed" is a complete
answer. Questions 1 to 9 are answered, so phase 1 can start once this ADR is
accepted. Questions 10 and 11 come from the decisions of 5 November, and 12 to 15
from building section 4's contact protections (7 November).

1. **What is the minimum age?** Recommendation: 13, subject to counsel (section 7,
   item 1); nobody under it, ever.
   - Answer: Yes, 13.
   - Answered by / date: Psami-wondah, 3 November 2026
   - Reaffirmed 5 November 2026: 13 on the web and in the app stores.

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
   - Changed 7 November 2026 (owner): subtle, the way X does it. Only the pictures
     and video are covered, under "Sensitive content", never the text, and no "18+"
     shows in a feed (Decision, above).

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
   - Changed: everyone is asked, those who ticked "18 or older" included, and must
     answer before they can use the app ("we need to have everybody's date of
     birth"). Psami-wondah, 6 November 2026.

7. **Are minors' posts public?** Recommendation: shown to signed-in members only,
   never to signed-out visitors or search engines, with replies limited to people
   they follow by default.
   - Answer: Agreed.
   - Answered by / date: Psami-wondah, 3 November 2026
   - Reaffirmed 7 November 2026 (owner), asked against X's protected posts (only
     followers the minor approves see the posts, kept out of search, no quotes by
     strangers) and against a middle way (only the people the minor follows):
     build question 7 as recorded. Any signed-in member sees a minor's posts,
     search, hashtags and topics included, and may quote or repost them; a
     signed-out visitor never does. Built: section 4, "Visibility, as built".

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

10. **What has to be true before the first 13 to 17 year old joins the beta?** The
    beta opens to 13 and over (decisions of 5 November); section 5 lists what phase
    2 waits for. Recommendation: keep section 5 as written. Item 3 is met once
    Arachnid Shield's login is set in production. Of item 1, the answer that matters
    most is the age of a child for consent (section 7, item 1): if it is 18, every
    13 to 17 signup needs a guardian's consent (question 2), and signup cannot work
    without it. Before the first minor, Gists must check the age band:
    `isCallsMember` in `apps/api/src/gists/eligibility.ts` checks only the `gists`
    flag's list today. (Since built: `canHostGist` needs `gist_stage`.)
    - Answer: The way X allows 13 to 17 year olds: they join the beta with the
      protections in section 4 on by default, without waiting for the rest of
      section 5 (section 5 says what still comes first). In Gists they listen only.
      No direct messages until the ID check for age exists.
    - Answered by / date: Psami-wondah, 6 November 2026

11. **What do the app store versions show?** Both stores rate an app from a
    questionnaire about what it shows, and labelled posts (question 3: graphic
    violence, non-sexual nudity, sexual talk) can raise the rating above 13+ even
    behind a cover. Recommendation: in the native apps, a labelled post is a
    placeholder ("This post is marked 18+") for everyone, so each store can rate
    the app 13+ for what it shows; and the store policies for social apps are met
    before the first submission (rollout doc section 7).
    - Answer:
    - Answered by / date:

12. **What does "mentions from strangers limited" mean for a minor?** A stranger is
    someone the minor does not follow. Recommendation: no notification and no
    link; the @handle stays plain text, as for a handle nobody has, and the post
    still goes up, so nothing tells its writer the account is a minor's. Refusing
    the post would tell them.
    - Answer: Agreed.
    - Answered by / date: Psami-wondah, 7 November 2026

13. **Can a minor loosen these defaults themselves?** Recommendation: no, fixed
    until they turn 18. They can narrow replies to people they mention, but not
    open them to everyone, allow strangers' mentions or appear in search. Nobody
    accountable can approve loosening while there is no guardian consent; revisit
    with counsel's answer (section 7, item 1).
    - Answer: Agreed.
    - Answered by / date: Psami-wondah, 7 November 2026

14. **Do minors appear in search and suggestions for other minors?** Ages are
    stated, not checked, so an adult can claim to be 15.
    - Answer: The way X does it. X defaults a known minor's account to protected
      posts, searchable "only by them and their followers", whatever the
      searcher's age (help.x.com, "Information for Parents and Minor Users", read 7
      November 2026). So a viewer's own age opens nothing: a minor appears only to
      the people they follow.
    - Answered by / date: Psami-wondah, 7 November 2026

15. **In someone else's open conversation, can strangers answer a minor's reply?**
    Recommendation: no. Replying straight to anything a minor wrote needs them to
    follow you (or to have mentioned you there); others can still reply elsewhere
    in the conversation.
    - Answer: Agreed.
    - Answered by / date: Psami-wondah, 7 November 2026

### Smaller open items

- **Quotes and reposts of a minor's posts.** Decided with question 7 (7 November
  2026): any signed-in member may quote or repost a minor's post, and the minor is
  told of a quote, as for anyone's. A signed-out visitor sees the quote with the
  quoted post unavailable, and the repost not at all.
- **Visibility of minors' posts (question 7) against X.** X defaults a minor's
  account to protected posts: only followers they approve see them, and their
  posts are kept out of public search. Asked on 7 November 2026, the owner kept
  question 7's answer (signed-in members only), so post search, hashtag and topic
  pages still list minors' posts to signed-in members. Protected posts would need
  follow requests, which HeyNaija does not have; question 7 is the place to
  change it.

- **Gists.** Minors and unknown ages listen only (6 November): `canHostGist` needs
  a stated adult age, and `canJoinGist` does not. Gist titles cannot be labelled;
  a live room for adults only is out of scope until Gists leave the allow-list beta (the `gists` flag's list).
- **Retention of `needs_label` reports** follows the other report reasons.
- **A stated date that a check contradicts.** How it is handled belongs in ADR 0018
  (PR #61). It is a reason for review, never an automatic change.
