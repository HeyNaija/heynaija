# ADR 0005 — Governance pages, a temporary 18+ beta, and switched-off groundwork for identity and voting

**Date:** 16 October 2026 · **Status:** Accepted (groundwork); verification and voting not approved

Updated 19 October 2026: [ADR 0010](0010-nonprofit-governance-v0.3.md) supersedes
the original membership assumptions and constitution version, preserving feature
locks and privacy/age guarantees. The v0.2 description below is historical.

## Decision

1. **Public governance information first.** `/governance` explains founding-stage
   status, the three kinds of participation, how votes would work, the path to
   community ownership and honest empty states for votes, the treasury and
   decisions. `/governance/constitution` publishes draft constitution v0.2 in
   full. `/governance/verification` and `/governance/membership` explain NIN
   verification and voting membership. Facts that several pages state (version,
   milestones, proposed thresholds) live in `apps/web/lib/governance.ts`.
2. **The beta is 18+, enforced on the server, as a temporary restriction.** The
   owner asked for under-18 accounts to stay disabled until child-safety
   requirements are approved, so the draft's proposed 18+ pilot rule is adopted
   for the beta only; HeyNaija is not meant to stay adults-only (ADR 0006,
   [under-18-rollout.md](../governance/under-18-rollout.md)). Signing up asks for an
   "I am 18 or older" confirmation, the web app sets an `hn_age` cookie, Kratos
   passes it to the registration webhook (`infra/kratos/invite-check.jsonnet`),
   and the API refuses any signup without it, including Google sign-ups and anyone
   who skips that box. The confirmation is stored as a stated age band, never an
   age or birth date, and never counts as a verified age. How age is modelled is
   in ADR 0006.
3. **Three switches that cannot be switched on.** `NIN_VERIFICATION_ENABLED`,
   `BINDING_GOVERNANCE_VOTING_ENABLED` and `UNDER_18_ACCOUNTS_ENABLED` default to
   false, and `apps/api/src/env.ts` refuses to start with any of them set to true.
   Enabling one means building the feature and changing that line in review, after
   the prerequisites in [open-items.md](../governance/open-items.md).
4. **A separate `restricted` Postgres schema** for anything that says more about
   a person than their public profile: `age_assurances`, `identity_verifications`,
   `governance_memberships` and `governance_audit_log`. Ordinary reads never join
   it. Public profiles read only `public.profile_badges`.
5. **Verification, membership, ballot eligibility and the badge are separate
   states** (draft Annex A). Verifying does not make anyone a member; being a
   member does not show a badge; the badge needs a reviewed, current verification
   and the member's choice, and is hidden everywhere while verification is off.
6. **No verification endpoint, no ballots table.** The only new endpoint is
   `GET /v1/me/governance` (the member's own status). `GovernanceService` holds the
   bookkeeping a future NINAuth integration would call, with its guarantees tested
   in SQL. Ballot and election tables wait for a security review, because ballots
   must never be stored as `member → choice` rows.

## Why

The draft constitution and the implementation brief both require that nothing on
the site implies identity checks, binding votes, a treasury or community
ownership exist before they do, and that the server, not hidden buttons, enforces
eligibility. Building the data model and the rules now, behind switches that
cannot be flipped by configuration alone, means the later work package starts
from tested guarantees rather than from UI copy.

## How

- **Eligibility rules** are pure functions in `apps/api/src/governance/rules.ts`
  (`badgeAllowed`, `membershipEligibility`, `ballotEligibility`,
  `bindingBallotMayOpen`), tested in `rules.test.ts`. The numbers are the draft's
  proposals and are labelled as such.
- **One verified account per person:** a partial unique index on
  `(provider, person_key) where status = 'verified'`. The person key is an HMAC of
  the provider's pseudonymous subject with `IDENTITY_KEY_SECRET`; it is never the
  NIN or a plain hash of it, never exported and never returned by an API. A
  second account for the same person is stored as `rejected / duplicate_person`
  for review and appeal.
- **Expiry needs no sweep:** a verified row past `expires_at` reads as expired,
  and `profile_badges.expires_at` hides the badge on read.
- **Audit:** every write in `GovernanceService` adds a row to
  `restricted.governance_audit_log` with a fixed event name and a short reason
  code, never free text or provider data.
- **Provider seam:** `NinVerificationProvider` in `governance/nin-provider.ts`,
  with `DisabledNinProvider` (always fails) and `TestNinProvider`, which refuses to
  be constructed outside `node --test` or under `NODE_ENV=production`. The planned
  flow is in [identity-verification.md](../governance/identity-verification.md).
- **Data export** is now `heynaija-export/2`: it adds the member's age records,
  verification history (without the person key) and voting membership.

## Consequences

- Sign-ups depend on the new jsonnet and the new API together. They ship in the
  same commit; if only one were deployed, every signup would be refused
  ("confirm your age"). Existing members are unaffected.
- Members who joined before 16 October 2026 have no age on record, and are
  treated as unknown age, never as adults for adult-only purposes. Asking them is
  an open item, and a prerequisite for under-18 accounts.
- The `restricted` schema is only a boundary today: the API still uses one
  database role. A separate role and encrypted columns are prerequisites for
  switching verification on.
- The governance pages are static. When something becomes true (a milestone, a
  feedback channel, the operator's name), the page changes in a commit.

## Rollback

Web and copy changes revert with the commit. To remove the schema, after
reverting the code: `drop table profile_badges; drop schema restricted cascade;`
and delete the `0014_governance_groundwork` entry from
`drizzle.__drizzle_migrations` (and `packages/db/drizzle/meta/_journal.json`).
Only do that before any real verification or age record exists; `age_assurances`
holds real sign-up records from the moment this is deployed.
