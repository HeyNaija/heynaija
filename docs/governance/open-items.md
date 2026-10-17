# Governance and identity: open items, approvals and release notes

Internal checklist for the operator. Everything public about these items is on
`/governance`, `/charter`, `/privacy` and `/rules`, where unknown details are shown
as visible `[placeholders]`, not guessed. Update this file when an item closes,
and change the public page in the same commit.

Last reviewed: 16 October 2026.

## 1. Facts the public pages still need (placeholders)

| Placeholder | Where | Needs |
|---|---|---|
| Operator name and address (the data controller) | `/privacy#who` | Operator / counsel |
| Privacy contact email | `/privacy#who`, `/privacy#rights` | Operator |
| Safety contact email | `/rules#appeals` | Operator |
| Custodians' names and roles | `/charter#stewards` | Founders |
| How HeyNaija is funded today | `/charter#stewards` | Founders |
| Charter notice period (the draft proposes 14 days) | `/charter#changes` | Founders, then adoption |
| Data-centre location | `/privacy#processors` | Operator |
| Cross-border transfer safeguards | `/privacy#processors` | Counsel |
| Retention: deleted posts, quarantined images, server logs, account deletion | `/privacy#keep`, `/privacy#rights` | Counsel |
| Retention for verification results | `/privacy#identity` | After the DPIA |

## 2. Needs legal review before anything is adopted

- [ ] The whole draft constitution (v0.2): cooperative, corporate and
      data-protection counsel in Nigeria (Article 13.4, Annex B).
- [ ] The temporary 18+ beta rule as now implemented: a self-declared
      confirmation at `/join`, refused server-side without it. Is a
      self-declaration enough age assurance for the pilot under the NDPA and the
      NITDA Code of Practice?
- [ ] The age model (ADR 0006): age bands only, statements kept as history,
      unknown never adult. Is a stated adult age enough to see content marked for
      adults once such labels exist (`ADULT_ASSURANCE_REQUIRED` in
      `apps/api/src/governance/age.ts`)?
- [ ] The mistaken-age procedure added to `/rules#age` (moderators may suspend an
      account believed to belong to someone under 18; the normal appeal applies;
      nobody is asked to post identity documents publicly).
- [ ] Whether members who joined before 16 October 2026 must confirm their age.
- [ ] Lawful basis and retention for `restricted.age_assurances`, including
      withdrawn statements kept as history.
- [ ] The person key (HMAC of the provider's subject): still personal data
      (Article 4.5). Lawful basis, retention, and whether it may be kept after a
      verification is revoked.
- [ ] Whether a fixed 14-day notice period may replace the charter placeholder
      before the constitution is adopted.
- [ ] Final legal vehicle and what member admission or fees it requires
      (Annex B.1).

## 3. Before `NIN_VERIFICATION_ENABLED` may change

All of these, then a reviewed code change to `apps/api/src/env.ts`:

- [ ] HeyNaija approved as a NINAuth verification partner; pricing and contract.
- [ ] Written confirmation from NIMC of the claims marked "requires provider
      confirmation" in `apps/api/src/governance/nin-provider.ts`: a stable
      pseudonymous subject per person, an over-18 claim, result lifetime, scopes.
- [ ] A data protection impact assessment, reviewed by Nigerian privacy counsel.
- [ ] `/privacy#identity` rewritten for live processing: what, why, lawful basis,
      retention, recipients, transfers.
- [ ] A separate database role for the `restricted` schema; the app's normal role
      loses access to it except through the code paths that need it. Column
      encryption for `person_key`. Separate admin and log access.
- [ ] `IDENTITY_KEY_SECRET` generated, stored in the password manager, rotation plan.
- [ ] The callback handler built per [identity-verification.md](identity-verification.md),
      with an independent security review.
- [ ] A reviewer workflow for `reviewVerification` and an appeals route for
      `duplicate_person` and revocations.
- [ ] Incident-response plan for identity data.
- [ ] Decide whether the public tick starts on or off (Annex B.4; the code
      assumes off, opt-in).

## 4. Before `BINDING_GOVERNANCE_VOTING_ENABLED` may change

- [ ] Everything in section 3.
- [ ] A member-controlled legal entity with adopted bylaws, or a legally reviewed
      founding procedure for the first election (Articles 8.11, 13).
- [ ] Opt-in flow with explicit acceptance of the governing documents
      (`governance_memberships.documents_version`).
- [ ] A ballot design reviewed for security, keeping eligibility separate from
      choices (no `member → choice` rows), with an independent audit method.
- [ ] Election method published (how many candidates each voter may pick).
- [ ] At least 100 verified, opted-in adults before any binding ballot
      (`bindingBallotMayOpen`).

## 5. Before `UNDER_18_ACCOUNTS_ENABLED` may change

The 18+ account rule is temporary; the intended model opens general social
features to eligible under-18s with consent and safeguards, while adult-only
content stays closed to them and voting stays 18+. Everything that must be
decided, approved and built first (age assurance, parental or guardian consent
where the law requires it, content restriction, contact and messaging limits,
moderation, privacy) is in [under-18-rollout.md](under-18-rollout.md).

## 6. Product items not yet built

- A working feedback channel for the drafts. The pages say "Feedback channel
  being prepared"; link it from `FeedbackNotice` in `apps/web/app/ui/governance.tsx`
  when it exists.
- Recording real governance decisions and treasury entries. The pages show empty
  states; tables for them should be added only with a way to publish actual,
  auditable records.
- In-app account deletion (privacy policy says to write in).
- Marking a milestone complete: change `OWNERSHIP_MILESTONES` in
  `apps/web/lib/governance.ts` with an `evidence` link; a test refuses a
  completed milestone without one.

## Release and rollback

- **Deploy order:** the API, the web app and `infra/kratos/invite-check.jsonnet`
  must go out together (one commit). The API refuses signups without
  `adult_declared`, which only the new jsonnet sends. `deploy.sh` hashes
  `infra/kratos/*` into the Kratos service label, so Kratos is recreated with
  the new jsonnet in the same `docker compose up`; a signup in the few seconds
  between the two restarts may be refused and can simply be retried. Migrations
  run before the new API starts; `0014` only adds a schema and tables.
- **Check after deploy:** join with a fresh invite (the 18+ box is required), and
  sign up; `/settings` shows "Identity and governance"; `/governance/*` load.
- **Roll back:** redeploy the previous commit (`deploy.sh <commit>`). The new
  tables are unused by older code and can stay. To remove them, see ADR 0005,
  "Rollback".
