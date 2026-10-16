# ADR 0006 — Age is its own status; 18+ is a temporary beta rule

**Date:** 16 October 2026 · **Status:** Accepted (model built; under-18 accounts not approved)

## Context

ADR 0005 made the beta 18+ with a server-side check. The owner then set the
intended long-term model:

- General social networking will eventually be open to eligible people under 18,
  with appropriate consent and child-safety safeguards.
- Content restricted to adults must stay inaccessible to minors.
- Formal governance voting needs age 18+, identity verification and voting
  membership.
- NIN verification and age verification are separate from having an account.
- Accounts whose age is unknown must not be treated as verified adults.

The first model could not express that: age was one "18+" row per account, the
provider's age claim was a column on the identity-verification row, and an
account with no row had no explicit status.

## Decision

1. **The 18+ rule for accounts is a temporary beta restriction**, not
   HeyNaija's membership policy. It stays enforced (`signupAgeDecision` in
   `apps/api/src/governance/age.ts`, called by the registration webhook), and
   `UNDER_18_ACCOUNTS_ENABLED` stays impossible to switch on, until the
   requirements in [under-18-rollout.md](../governance/under-18-rollout.md) are
   approved and built.
2. **Age has its own table and its own status.** `restricted.age_assurances`
   holds statements about an account holder's age band (`under_18` or
   `18_plus`), each with how it was established (`self_declared`,
   `moderator_review`, `identity_provider`, `age_assurance_provider`), when, and
   whether it has been withdrawn. Rows are history; nothing is overwritten.
3. **One derived status for everything that needs an age.** `ageStatus()` picks
   the strongest live statement (a check beats a moderator, who beats the
   person's own word; newest wins between equals) and returns
   `{ band, assurance, reviewDue }`, with `band: 'unknown'` when nothing is on
   record. `isAdultFor(status, purpose)` is the only adult test:
   - `age_restricted_content` needs at least a stated adult age (`declared`);
   - `governance_vote` needs a verified adult age (`verified`).
   Unknown and under-18 never pass either.
4. **Identity and age are separate records.** An age result from a NINAuth check
   becomes its own `age_assurances` row linked by `verification_id`; revoking the
   check withdraws it. `identity_verifications` no longer has an `over_18` column.
   Age could also be verified without an identity check (`age_assurance_provider`).
5. **Minimum data.** Only a band is stored, never a birth date, an exact age or a
   document. For a future under-18 band, `review_after` records when to check
   again (at the latest the month the person turns 18, rounded up), so an account
   can move to adult without a birth date being kept. Nothing writes `under_18` yet.
6. **Unknown is said plainly.** Accounts created before 16 October 2026 have no
   age on record. Settings tells members their own status ("Not on record", or
   "18 or older" stated or verified), the data export lists every age record, and
   the age is never shown on a profile or in any public API.

## Consequences

- Voting membership gains a separate condition, `age_not_verified`; a signup
  declaration never satisfies it.
- There is no age-restricted content label yet, so `isAdultFor('age_restricted_content')`
  has no caller. Labelling and enforcing it in every read path (including media
  URLs, which are public today) is a prerequisite for under-18 accounts.
- Before under-18 accounts open, members whose age is unknown must be asked to
  confirm it; until they do they count as not adult for adult-only content.
- `moderator_review` and `age_assurance_provider` have no writer yet. The
  mistaken-age process in the rules is carried out today by suspending the
  account, without an age record.

## Supersedes

Decision 2 of ADR 0005 ("The beta is 18+") stands, but as a temporary rule, and
its single-row `age_assurances` table is replaced by the model above. Migration
`0014_governance_groundwork` was revised in place before it was ever committed or
deployed.
