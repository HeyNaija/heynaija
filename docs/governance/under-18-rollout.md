# Opening HeyNaija to people under 18: requirements

**Status:** not approved, not built. Under-18 signups are refused by the API, and
`UNDER_18_ACCOUNTS_ENABLED` cannot be switched on (`apps/api/src/env.ts`). The 18+
rule for accounts is a temporary beta restriction (ADR 0006); this document is what
has to be decided, approved and built before it can be lifted.

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

- [ ] **Minimum age** (for example 13) and whether 13–15 and 16–17 need different
      protections. Add finer bands to `AGE_BANDS` only if a protection actually
      differs; otherwise `under_18` is enough.
- [ ] **Legal basis and duties for children's data.** The Nigeria Data Protection
      Act 2023 has specific rules for processing children's personal data,
      including parent or guardian consent and appropriate age verification
      (counsel to confirm the section, what counts as "appropriate", and the age
      of a child for this purpose). Also the Child Rights Act 2003, the NITDA Code
      of Practice for platforms, and the laws of countries where diaspora members
      live.
- [ ] **How strong age assurance must be**, at signup for minors and for seeing
      adult-only content (today `age_restricted_content` accepts a stated adult age:
      confirm or raise it).
- [ ] **Whether minors' posts are public.** Every post is public today; that may
      not be acceptable for children.
- [ ] **What happens to existing accounts with no age on record.**
- [ ] **A privacy impact assessment for children's data**, reviewed by counsel.

## 2. Age assurance

- [ ] Signup asks which band someone is in, never a full birth date, unless counsel
      says a birth date is necessary. If it is, document why, derive the band and
      `review_after` from it, and do not keep the date.
- [ ] Below the minimum age: refuse, explain kindly, keep no age record.
- [ ] Minors get `review_after` (the month they turn 18, rounded up, or a periodic
      re-check) and move to adult only after a fresh statement or check.
- [ ] Ask every member with an unknown age to confirm it before any minor can join.
      Until they do, they are not adult for adult-only content (already enforced by
      `isAdultFor`).
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
      authors, community settings and moderators.
- [ ] Enforced on the server in every read path: feeds, threads, replies, search,
      trending, profiles, notifications, community pages and the data export of
      other people's posts. Default deny for `under_18` and unknown ages.
- [ ] Images: processed media is served from a public bucket under `/media`, which
      bypasses the API. Adult-only images need signed or proxied URLs, or must not
      be allowed.
- [ ] Minors cannot join communities marked for adults.
- [ ] Unlawful material stays prohibited for everyone, whatever the label.

## 5. Contact and messaging safeguards

- [ ] Direct messages do not exist. If they are ever built: off for minors by
      default, never from adults the minor does not follow, message requests rather
      than open inboxes, block and report inside the conversation, and a published
      retention and scanning policy.
- [ ] Replies and mentions: minors can limit replies to people they follow, and
      mentions from strangers are limited by default.
- [ ] Discovery: minors are not suggested to adults, and are left out of member
      search by default.
- [ ] Profiles of minors show the minimum: no location, no age band, no follower
      lists to strangers unless counsel and safeguarding review agree otherwise.

## 6. Moderation and safety

- [ ] A child-safety report reason with priority triage and a published response
      target.
- [ ] Moderators trained in child safety; a written escalation route to the
      authorities.
- [ ] Hash-matching of known abuse material in place for all uploads (PhotoDNA or
      equivalent; see docs/safety/abuse-material-scanning.md), not only the
      Cloudflare tool.
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
- [ ] Only then: change `UNDER_18_ACCOUNTS_ENABLED` in `env.ts`, in review, and
      extend the `/join` age question and `infra/kratos/invite-check.jsonnet`.
