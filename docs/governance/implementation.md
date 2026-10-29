# Governance implementation review — v0.3

19 October 2026. Reviewed latest `origin/staging` commit
`32e592f94d5ac3d8b99f2460497a859b0d0d4981` before editing. No commit or push.
This revision changes proposals, explanatory pages and limited eligibility
preparation; it does not build legal registration or activate governance.

## Model boundaries

| Existing structure | What it represents / required next step |
|---|---|
| `public.members` | Platform account; never proof of legal association membership. Ordinary social functionality is unchanged. |
| `restricted.governance_memberships` | Voluntary online participation only. Existing `resigned` status means online deactivation, not legal resignation. No live opt-in/out endpoint exists. |
| `restricted.identity_verifications` | Private provider verification history; reviewed current result, stable pseudonymous key and separate age facts required. NINAuth implementation remains absent. |
| `restricted.age_assurances` | Separate age bands and assurance; declaration supports current beta account policy, not voting. Unknown age never adult. |
| `public.profile_badges` | Optional public tick, hidden while verification disabled; also the Founder badge, granted by hand and unrelated to identity, which governance writes never touch. No private identity joins in public profile queries. |
| `LegalMembershipFacts` in API rules | Preparatory facts for a future lawful association register. No admission database or service exists. Omitted/non-admitted/suspended/ended/future admission fails voting eligibility. |
| `COUNCIL_PROPOSAL` in web metadata | Three trustees, three years, common cycle; two representatives, one year; founding first election at term expiry; quorums two/three. Descriptive proposal only, no scheduler or appointments. |

`GovernanceService.statusFor` explicitly supplies no legal admission record,
therefore an account cannot qualify even with a verification and online row.
This is intentional fail-closed groundwork. It does not suspend any actual
association member or decide lawful formal meeting rights. Existing read-only
own-status response shape stays compatible; it adds a possible private
`not_legal_member` unmet code. No legal member record is inferred from NIN.

`ballotEligibility` now also requires the separate legal admission date before
the 14-day freeze. No live caller or election engine was introduced.

## Implementation needed before activation

1. Obtain the adopted registered constitution, actual founding appointments,
   effective incorporation/expiry dates and legal advice on each authority and
   formal member procedure. Do not backfill guessed dates or trustees from app roles.
2. Design a private association register and audited admission, appeal, suspension,
   cessation and record-inspection lifecycle under counsel-approved rules. Keep
   legal membership intact on online opt-out, verification expiry or account
   closure; handle retention and recovery without disclosing identity publicly.
3. Link an eligible admitted person to at most one active online identity. Build
   voluntary activation/deactivation, document-version acceptance, immutable cutoff
   snapshots and effective-date handling. Keep lawful meeting rights outside the
   platform ballot service; opt-out cannot remove them.
4. Complete the NINAuth/age/privacy/security gates without assuming the provider
   supplies the required claims. Alternative legally acceptable methods require
   approved equivalent safeguards, cross-provider duplicate detection and reviewed
   person-key migration; no new alternative provider is implemented here.
5. Build independent nomination, election, recall, dispute and vacancy procedures
   as distinct contests: three trustee seats together at founding expiry and each
   three years thereafter, two representative seats annually from readiness.
   Preserve the retained two-full-term limit, remainder-only vacancies and secret
   ballots. Store legal effectiveness separately from an online result; the engine
   must never automatically grant/revoke legal trustee status or submit CAC filings.
6. Separate democratic term calendars from registered status and counsel-authorised
   processing arrangements. Activation must not reset the founding term. Prepare
   180 days before expiry, publish timetable by 90 days before; never infer a
   rolling founder extension from disabled features. Constitutionally authorised
   formal meeting fallback remains a separately documented legal process.
7. Design secure ballots and independent audits with eligibility separate from
   choice; preserve existing thresholds, privacy and server enforcement. Test
   legal admission, activation, age, identity, uniqueness, freezes, nominees,
   vacancies, recalls, disputes and public redaction before any release review.
8. Establish statutory records, filing calendar, bank approvals, conflicts, actual
   financial reporting and asset inventory/transfer evidence before treating those
   milestones as complete. No payment or donation collection is part of this work.

## Preserved controls

The API startup validator still refuses true values for
`NIN_VERIFICATION_ENABLED`, `BINDING_GOVERNANCE_VOTING_ENABLED` and
`UNDER_18_ACCOUNTS_ENABLED`. The disabled provider, test-only provider restrictions,
identity minimisation, optional badge, verified-adult rule, restricted storage,
uniqueness constraints, append-only audit events, privacy-conscious export,
moderation independence, reports/appeals and ordinary social flows remain.
No runtime trustee/councillor roles, election tables, admission migration, identity
callback, ballot write endpoint, CAC automation or payment workflow is added.

## Document consistency

The public constitution renders `apps/web/lib/constitution.ts`. The CAC review
copy is generated from it with the same version/history; `pnpm governance:check`
fails if they diverge. The charter shares the seven-phase roadmap and public
transition explanation. Constitution article anchors 1–14 and Annex A/B remain.
Update all public explanations, the charter and supporting policies together on
future amendments. Historical v0.2 sources are explicitly superseded.
