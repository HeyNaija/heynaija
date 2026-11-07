# Opening HeyNaija to people under 18: requirements

**Status:** not approved, not built. Under-18 signups are refused by the API, and
`UNDER_18_ACCOUNTS_ENABLED` cannot be switched on (`apps/api/src/env.ts`). The 18+
rule for accounts is a temporary beta restriction (ADR 0006); this document is what
has to be decided, approved and built before it can be lifted.

**Plan:** [ADR 0020](../adr/0020-under-18-accounts-and-adult-labels.md) (proposed,
3 November 2026) orders this checklist into two phases. Phase 1, with the 18+ rule
kept: a date of birth at signup and 18+ labels (sections 2 and 4). Phase 2: the rest,
then opening to minors.

**Owner decisions, 5 and 6 November 2026** (ADR 0020, "Decision"): the beta opens
to 13 to 17 year olds the way X lets them in, with protections on by default; 13 is
the minimum on the web and in the app stores; signup asks for a date of birth and a
confirmation that it is true; until an age check exists, that stated age is what the
age gates read; minors listen to Gists but never host or speak; direct messages and
calls are not built until the ID check for age exists; governance voting needs an
ID-verified age. What still comes before the first minor joins is in ADR 0020,
section 5; the other items below follow during the beta.

**Intended model (owner, 16 October 2026):**

- General social networking will eventually be open to eligible people under 18,
  with appropriate consent and child-safety safeguards.
- Content restricted to adults must stay inaccessible to minors.
- Formal governance voting stays 18+, with identity verification and voting
  membership. Minors are never voting members.
- Age verification and NIN verification are separate from having an account.
- Accounts whose age is unknown are not treated as verified adults.

Nothing below is legal advice. Every legal point is for Nigerian counsel to confirm,
including for members who live outside Nigeria.

## Already in place

- `restricted.age_assurances`: age band (`under_18`, `18_plus`), how it was
  established, when, `review_after` for minors, withdrawal. No birth dates.
- `ageStatus()`, `isAdultFor()` and `signupAgeDecision()` in
  `apps/api/src/governance/age.ts`, with tests. Unknown never counts as adult;
  governance needs a verified adult age.
- Settings shows each member their own age status; the data export lists it; it is
  never public.
- Images are re-encoded on upload (location data removed), there are reporting,
  blocking, muting, appeals and a moderation log, and there are no direct messages.

## 1. Decisions needed before any building

- [x] **Minimum age:** 13, on the web and in the app stores (owner, 3 and 5
      November 2026; ADR 0020, question 1).
- [ ] Whether 13–15 and 16–17 need different protections. Add finer bands to
      `AGE_BANDS` only if a protection actually differs; otherwise `under_18` is
      enough.
- [ ] **Legal basis and duties for children's data.** The Nigeria Data Protection
      Act 2023 has specific rules for processing children's personal data,
      including parent or guardian consent and appropriate age verification
      (counsel to confirm the section, what counts as "appropriate", and the age
      of a child for this purpose). Also the Child Rights Act 2003, the NITDA Code
      of Practice for platforms, and the laws of countries where diaspora members
      live.
- [ ] **How strong age assurance must be**, at signup for minors and for seeing
      adult-only content (today `age_restricted_content` accepts a stated adult age:
      confirm or raise it). Hosting and speaking in Gists (`gist_stage`) and posting
      video (`video_posting`) accept a stated adult age too, by the owner's decisions
      of 5 and 6 November 2026 and ADR 0019 section 4.6.
- [ ] **Whether minors' posts are public.** Every post is public today; that may
      not be acceptable for children.
- [ ] **What happens to existing accounts with no age on record.** Owner decision,
      6 November 2026: everyone already here gives a date of birth before they can
      use the app again; a 13 to 17 year old is kept as a minor and moderators are
      told, and under 13 the account is suspended until a moderator looks (ADR
      0020, section 1). Counsel to confirm.
- [ ] **A privacy impact assessment for children's data**, reviewed by counsel.

## 2. Age assurance

- [ ] Signup asks which band someone is in, never a full birth date, unless counsel
      says a birth date is necessary. If it is, document why, derive the band and
      `review_after` from it, and do not keep the date. Owner decision, 3 November
      2026: signup asks for a date of birth, derives the band from it, and keeps the
      date with the age record, seen only by the member (ADR 0020, section 1, with
      the reasons in question 5); counsel to confirm (ADR 0020, section 7, item 3).
      Owner decision, 5 November 2026: the date comes with a tick confirming it is
      the person's real date of birth.
- [ ] Below the minimum age: refuse, explain kindly, keep no age record.
- [ ] Minors get `review_after` (the month they turn 18, rounded up, or a periodic
      re-check) and move to adult only after a fresh statement or check. Owner
      decision, 6 November 2026: the age is worked out from the date of birth on
      every check instead, so a minor is an adult from their 18th birthday without
      a fresh statement (ADR 0020, section 1). Counsel to confirm.
- [ ] Ask every member with an unknown age to confirm it before any minor can join.
      Until they do, they are not adult for adult-only content (already enforced by
      `isAdultFor`). Built (branch `feat/date-of-birth-everyone`): everyone without a
      date of birth, those who ticked "18 or older" included, is asked on their next
      visit and sees nothing else until they answer. Done once it is in production
      and every account has answered or been closed.
- [ ] Risk-based checks beyond self-declaration: reports, signals, and moderator
      review recorded as `moderator_review`, with notice and appeal. Never ask anyone
      to post documents publicly.
- [ ] If a separate age-assurance provider is used (`age_assurance_provider`),
      choose it with a privacy review; it must not require a NIN.
- [ ] Identity (NIN) verification is not offered to minors unless separately
      approved; it is not needed for anything a minor can do.

## 3. Parental or guardian consent, where the law requires it

- [ ] A separate consent record, never on the child's public profile: who consented
      (minimum contact details), how they were confirmed to be a parent or guardian
      and an adult, what they agreed to (versioned), when, and withdrawal.
- [ ] The child's account stays pending until consent is complete.
- [ ] Withdrawal of consent restricts the account at once and starts the agreed
      deletion or retention path.
- [ ] How a parent or guardian exercises the child's data rights (access, export,
      correction, deletion), balanced against the child's own privacy; counsel to
      set what a guardian may see.
- [ ] `signupAgeDecision` checks consent for `under_18` before allowing a signup.

## 4. Content restricted to adults

- [ ] A label for posts, communities and images that are for adults only, set by
      authors, community settings and moderators. Built for posts (branch
      `feat/sensitive-labels`): shown as "sensitive", the way X does it (ADR 0020,
      owner decision of 7 November 2026), set by the author in the composer or the
      post's menu, by Settings for everything they post, and by moderators. Not
      yet for whole communities.
- [ ] Enforced on the server in every read path: feeds, threads, replies, search,
      trending, profiles, notifications, community pages and the data export of
      other people's posts. Default deny for `under_18` and unknown ages. Built for
      posts (`adultContentAllowed` in `apps/api/src/governance/adult-content.ts`,
      tested route by route in `apps/api/src/posts/sensitive.test.ts`); marked posts
      also never trend and are never in Discover. Done once it is in production.
- [ ] Images: processed media is served from a public bucket under `/media`, which
      bypasses the API. Adult-only images need signed or proxied URLs, or must not
      be allowed.
- [ ] Minors cannot join communities marked for adults.
- [ ] Minors cannot post video (ADR 0019, section 4.6). Built (branch
      `feat/under-18-gists-video`): `assertVideoEligible` in
      `apps/api/src/video/video-eligibility.ts` needs an adult by stated age
      (`video_posting`) when an upload starts and again when the video goes on a
      post, so under 18 and unknown ages can do neither, and `/v1/me` turns
      `videoPosts` off for them, which hides the video button. Done once it is in
      production.
- [ ] Unlawful material stays prohibited for everyone, whatever the label.

## 5. Contact and messaging safeguards

- [ ] Direct messages do not exist. If they are ever built: off for minors by
      default, never from adults the minor does not follow, message requests rather
      than open inboxes, block and report inside the conversation, and a published
      retention and scanning policy.
- [ ] Direct messages and calls are not built until the ID check for age exists
      (ADR 0018), and then need it (owner, 6 November 2026).
- [ ] Gists: `under_18` and unknown ages listen only, never host, co-host or
      speaker (owner, 6 November 2026). Built (branch `feat/under-18-gists-video`):
      `canHostGist` in `apps/api/src/gists/eligibility.ts` needs an adult by stated
      age (`gist_stage` in `apps/api/src/governance/age.ts`). It is checked when a
      Gist starts, on a request to speak, when a host makes someone a speaker or
      co-host (refused as for a block, so the host learns nothing about the
      listener's age), and every time the room's permissions are set, so LiveKit
      never lets them publish, even with a role given before. They still see and
      join Gists as listeners; the web app does not offer them Start a Gist or
      Request to speak (`gistStage` in `/v1/me`). Members who have not given a
      date of birth are unknown and listen only too. Done once it is in production.
- [ ] Replies and mentions: minors can limit replies to people they follow, and
      mentions from strangers are limited by default. Built (branch
      `feat/under-18-contact`, `apps/api/src/governance/minors.ts`): a minor's
      conversations are limited to people they follow, and replying straight to
      anything they wrote needs them to follow you; a stranger's @mention of them
      is plain text with no notification; a minor cannot loosen either (ADR 0020,
      questions 12, 13 and 15). Done once it is in production.
- [ ] Discovery: minors are not suggested to adults, and are left out of member
      search by default. Built (same branch): a minor is in nobody's Discover,
      member search, @mention suggestions or welcome-flow suggestions but the
      people they follow, whatever the viewer's age, as X does (ADR 0020, question
      14). Done once it is in production.
- [ ] Profiles of minors show the minimum: no location, no age band, no follower
      lists to strangers unless counsel and safeguarding review agree otherwise.
      Met: profiles have no age band, location or follower lists for anyone, and
      `minors.test.ts` pins a profile's fields so a new one is decided in ADR 0020
      first. Done once it is in production.

## 6. Moderation and safety

- [ ] A child-safety report reason with priority triage and a published response
      target.
- [ ] Moderators trained in child safety; a written escalation route to the
      authorities.
- [ ] Hash-matching of known abuse material in place for all uploads (PhotoDNA or
      equivalent; see docs/safety/abuse-material-scanning.md), not only the
      Cloudflare tool. Built: Arachnid Shield (`apps/api/src/media/scanners.ts`);
      done once `ARACHNID_SHIELD_USERNAME` and `ARACHNID_SHIELD_PASSWORD` are set in
      production.
- [ ] Moderators see only "minor" or "adult" where they need it, never more.
- [ ] The mistaken-age process (rules, "Who can join") updated for a world with
      minors: notice, appeal, and no public documents.
- [ ] Aggregated transparency reporting on child-safety cases.

## 7. Policy, privacy and release

- [ ] Privacy policy rewritten for children's data, with a version a child can
      understand.
- [ ] Rules updated for minors' accounts; Terms where needed.
- [ ] Draft constitution Article 3 and Annex B.5: the youth decision taken and
      published through the governance process.
- [ ] Security review; end-to-end tests for minor signup, consent, content
      restriction and contact limits.
- [ ] App store listings rated 13+, from each store's questionnaire answered for
      what the app shows (ADR 0020, question 11). The rating keeps nobody out:
      signup applies the minimum age on every platform, the web included.
- [ ] Store policies for social apps met before the first submission: Google
      Play's Child Safety Standards (published standards against child sexual abuse
      and exploitation, in-app reporting, a child-safety contact:
      contact@heynaija.ng) and Apple's rules for user-generated content (filtering,
      reporting, blocking, published contact details).
- [ ] Only then: change `UNDER_18_ACCOUNTS_ENABLED` in `env.ts`, in review, and
      extend the `/join` age question and `infra/kratos/invite-check.jsonnet`.
