# Governance and identity: open items, approvals and release notes

Internal checklist for the operator. Everything public about these items is on
`/governance`, `/charter`, `/privacy` and `/rules`, where unknown details are shown
as visible `[placeholders]`, not guessed. Update this file when an item closes,
and change the public page in the same commit.

Last reviewed: 19 October 2026 (draft v0.3).

Canonical framework: [README.md](README.md), [CAC review copy](cac-constitution.md),
[policies](policies.md), [legal review](legal-review.md) and [implementation](implementation.md).

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

- [ ] The whole draft constitution (v0.3), Community Governance Charter and supporting
      policies: qualified Nigerian nonprofit/corporate and privacy counsel, including
      Incorporated Trustees under CAMA Part F, founding terms and Annex B. No adoption
      or filing before written review and completion of Schedule 1.
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
- [ ] Confirm the preferred Incorporated Trustees structure, lawful objects/name,
      three founding trustees’ eligibility (including CAC residence requirements),
      founding resolutions and initial Chairperson/Secretary appointments.
- [ ] Approve initial fixed three-year terms from incorporation, no immediate
      re-election on activation, first election at expiry and all three seats on
      the common three-year cycle; retain lawful recall and term limits.
- [ ] Validate the initial three-trustee body, full three-plus-two Council, powers,
      non-conflicted quorum and separate annual representative elections.
- [ ] Approve legal-member admission/cessation, equal access to voluntary online
      voting and protected formal meeting rights on online opt-out; validate
      requisitions, notice, quorum and electronic/hybrid procedures.
- [ ] Approve trustee removal/replacement, same-person re-election filing treatment,
      particulars/office changes, constitutional amendments and separate returns.
- [ ] Validate election preparation 180 days before expiry, timetable by 90 days
      before expiry, lawful formal-member fallback and any non-renewable 90-day
      caretaker authority; never automatic indefinite founder extensions.
- [ ] Resolve s838 paid-office/benefit restrictions for trustees and representatives;
      no founder salary assumption. Approve separated operational employment,
      conflicts, bank mandate, funding, tax, audits, assets and dissolution.
- [ ] Review all items in [legal-review.md](legal-review.md) and the final adopted
      charter/constitution for consistency, including required constitutional
      recognition of supporting policies.

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
- [ ] A legally incorporated nonprofit with an adopted registered constitution,
      recorded founding trustee terms and lawful association resolution procedures
      (Articles 6–9 and 13). Online activation elects only two representatives; it
      must not reset or shorten the initial trustee term.
- [ ] Separate audited legal-membership admission register and fair appeals, linked
      to voluntary online activation without treating an account, verification or
      opt-in as admission. GovernanceService currently supplies no admission facts
      and eligibility fails closed.
- [ ] Online opt-out preserves legal membership and formal meeting rights. The
      existing online `resigned` status must never mean legal resignation.
- [ ] Opt-in flow with explicit acceptance of the governing documents
      (`governance_memberships.documents_version`).
- [ ] A ballot design reviewed for security, keeping eligibility separate from
      choices (no `member → choice` rows), with an independent audit method.
- [ ] Election methods, nomination qualifications, equal candidate access, independent
      oversight, recall, disputes, term limits, vacancy calendar and legal
      follow-through published for separate three-seat trustee and two-seat
      representative contests. App roles must not grant statutory authority.
- [ ] At least 100 eligible verified, opted-in adult legal members before any binding online ballot
      (`bindingBallotMayOpen`).

## Additional controls before funds or legal asset-control claims

- [ ] Trustee-approved multi-signatory bank mandate, expenditure limits, conflicts
      register, funding/revenue clearance and independent accounts/audit calendar.
- [ ] Documented legal resolutions, CAC actions and effective dates; no online
      appointment/removal or automated filing assumptions.
- [ ] Signed asset instruments, licence/contract consents, organisational access
      and shared recovery; independent confirmation and final transition report.
- [ ] Complete operator, funding, trustee/officer names, registered office and
      Schedule 1 before adoption/filing; publish only appropriate public details.

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
