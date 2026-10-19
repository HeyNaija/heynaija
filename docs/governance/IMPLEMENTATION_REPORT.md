# HeyNaija governance update — implementation report

**19 October 2026 · Draft v0.3 · Not adopted or legally operative**

Reviewed and fetched `origin/staging` before editing; the checkout matched commit
`32e592f94d5ac3d8b99f2460497a859b0d0d4981` and was clean. Changes remain local
and uncommitted. Nothing was pushed, deployed, legally adopted or filed with CAC.

## 1. Files modified and added

The complete inventory is at the end of this report. It covers public pages,
shared constitution/version/roadmap data, preparatory eligibility rules and tests,
CI consistency checks, legal/policy documentation and preserved historical drafts.

Principal review documents:

- [CAC-facing constitution](cac-constitution.md): generated from the exact text
  rendered by `/governance/constitution`, with Articles 1–14, Schedule 1 and Annexes A/B.
- `/charter`: Community Governance Charter, keeping current service promises and
  clearly labelling future governance as proposed.
- [Supporting policies](policies.md), [legal review](legal-review.md),
  [founding records](founding-records.md), [technical specification](implementation.md)
  and [dated history](CHANGELOG.md).

## 2. Governance changes

The preferred vehicle is nonprofit Incorporated Trustees under CAMA Part F,
subject to Nigerian legal review and CAC approval. The documents prohibit private
shareholders, profit distributions, permanent founder rights and purchased voting
power; protect independence and essential assets; and require lawful nonprofit
residual-asset treatment on dissolution. They do not claim current incorporation
or legal community ownership.

The seven transition phases now distinguish founding association, incorporation,
legal membership, elected representation, elected trustee leadership, legal asset
vesting and final independent confirmation. Each milestone retains truthful status
and an evidence requirement before it may be marked complete. No completed
incorporation, election or transfer is invented.

## 3. Founding trustees and Council

Three founders are proposed as the three initial trustees, appointed by lawful
founding association procedures and included in the initial CAC application.
Initial tenure is three years, proposed from incorporation and expressly subject
to counsel review. Schedule 1 and the founding-records checklist require actual
names, qualifications, consents, resolutions, officers and dates before adoption.
No placeholder creates a registered trustee.

Community activation does **not** trigger immediate community-wide re-election
of those trustees. They complete the initial term subject to lawful recall,
removal, resignation, death, incapacity and disqualification. There is no founder
renewal entitlement, reserved seat, preference, lifetime office or special vote.

After incorporation, the initial three-trustee governing body has proposed quorum
two. After election of the two representatives the full Council is three trustees plus
two representatives, quorum three. Routine decisions require a majority of
non-conflicted members present; a tie fails. Representatives have delegated
oversight powers, not automatic statutory trustee powers. Interim officers add no
Council votes or founder veto. All arrangements need constitutional and legal approval.

## 4. Election schedules, recall and succession

| Office | Seats / cycle | First regular election |
|---|---|---|
| Registered trustees | All 3 together every 3 years; no staggering | At founding three-year term expiry; eligible founders compete equally |
| Community representatives | 2 annually, one-year terms | After governance readiness gates are satisfied |

The prior two-consecutive-full-term safeguard is retained per office category,
followed by a one-full-term break. The founding trustee term counts; vacancy
replacements serve the remainder without resetting the common cycle.

Prepare trustee elections at least 180 days before expiry and publish the calendar
by 90 days before expiry. If the platform is unavailable, a legally validated formal
member meeting must conduct selection by expiry. Any otherwise necessary caretaker
arrangement requires an express legal basis and independently reviewed prior member
resolution, is limited to essential operations and succession for at most 90 days,
and cannot renew under that clause. No automatic or indefinite founder holdover.

Preserve independent nominations, secret equal-weight auditable ballots, published
results, fair recall and dispute resolution. A 10% petition initiates recall;
formal legal-member requisition provides a separate route without online opt-in.
No founder permission is required. Trustee changes still require necessary
association resolutions and applicable CAC action; online results alone confer
or remove no statutory status. Annual returns, same-person renewal, replacement,
particulars changes, officer changes and constitutional amendments are distinct.

## 5. Membership and voting

Platform users, formally admitted legal members and voluntarily active voting
members are separate. Every eligible legal member has equal access to activation;
online opt-out does not end legal membership or lawful formal-meeting rights.
One person has one equal-weight ballot per contest, with no votes bought by money.

Preserve verified adult voting age, identity review and uniqueness, 30-day account
age, the 14-day eligibility freeze and minimum 100-person online electorate.
NIN remains initially preferred; the constitution permits future legally acceptable
alternatives with equivalent age, uniqueness and privacy safeguards. No alternative
provider or NIN verification feature is activated.

The existing `governance_memberships` table means online participation, not legal
admission. Preparatory rules now require separate legal admission facts and its
pre-freeze date. The service supplies no admission evidence because a lawful
register is not built, so verification and online opt-in alone cannot qualify.
The private own-status API shape remains compatible, adding a possible
`not_legal_member` gap. No admission database or migration was introduced.

## 6. Existing safeguards preserved

- All three startup locks remain: NIN verification, binding governance voting and
  under-18 access are refused when configured true until separately implemented
  and approved. The current beta age declaration and ordinary social use remain.
- Existing proposal endorsements, consultation periods, turnout thresholds,
  independent oversight, secrecy, failed-quorum reruns, appeals, conflicts and
  emergency review within seven days are retained.
- Moderation of individual posts/accounts remains outside public votes; independent
  appeals, privacy redaction, restricted identity records, uniqueness controls,
  badge choice and data export remain protected.
- Existing visual identity, page components and accessibility semantics are kept;
  article anchors remain. Treasury and decision history continue as honest empty states.
- Nonprofit finances now propose multiple bank signatories/two independent
  approvals, budgets, accounts, audit, quarterly public reporting, funding
  independence and written clearance of restricted compensation.

## 7. Legal questions requiring review

Qualified Nigerian nonprofit counsel must review **the whole final constitution,
charter, policies and founding records before adoption/incorporation**, including:

- ss825–827 appointments, qualifications, CAC residence restrictions, objects,
  founding fixed terms, initial term commencement and complete signed records;
- ss833–837 formal resolutions, electronic/hybrid meetings, member rights,
  Council authority/quorum, replacement/removal, same-person renewal filings,
  CAC assent/effective dates and continuity while processing;
- s838 paid offices and benefits for trustees and representatives, including
  ex-officio wording and allowed expenses/rent/service fees. No assumption that
  a founding trustee can also draw an operational salary; disinterested approval
  and recusal cannot legalise a prohibited payment;
- lawful first-election fallback and any non-renewable temporary authority;
- accounts, audits, statutory return calendars, banking, permissible income, tax,
  NDPA/privacy, asset title/licences/contracts, vesting and s850 dissolution.

Sources inspected: [CAC-hosted CAMA Gazette](https://news.cac.gov.ng/wp-content/uploads/2020/12/CAMA-NOTE-BOOK-FULL-VERSION.pdf),
[CAC Companies Regulations 2021](https://news.cac.gov.ng/wp-content/uploads/2021/01/COMPANIES-REGULATIONS-2021-published.pdf)
and [CAC Operations Checklists 2022](https://news.cac.gov.ng/wp-content/uploads/2022/05/Corporate-Affairs-Commission-Operations-Checklists-2022.pdf).
The detailed [review register](legal-review.md) distinguishes verified source text,
proposed internal rules and issues needing interpretation/current-practice confirmation.

## 8. Pending features

Formal legal-member admission/register, activation/deactivation flow, production
NINAuth and alternative identity providers, independent secure ballots, nomination
and dispute workflows, trustee legal-status records and appointment systems, CAC
filing automation, payments/donation collection, actual public treasury/decision
records, completed legal asset transfer and under-18 safeguards remain pending.
No unfinished capability was activated. No online election or draft is treated
as proof that incorporation, trustee appointment or asset control occurred.

## 9. Validation results

| Check | Result |
|---|---|
| `pnpm typecheck` | Passed across the workspace, including API, web, DB and e2e types |
| Full API suite | 336 passed, 0 failed, 0 skipped, against local Docker test Postgres/Redis |
| Final targeted API governance regression | 39 passed, including a reviewed verified adult with an online row who still lacks legal admission |
| Web unit suite | 35 passed, including separate cycles, milestones and public/CAC-copy consistency |
| Desktop/mobile governance e2e | 10 passed, including public drafts, anchors, mobile fit, verification FAQ/badge keyboard behaviour, membership, Settings, profile and data export |
| Roadmap tests | 7 passed; registry remains 80 features, with blocked/not-live statuses preserved |
| `pnpm governance:check` | Passed; generated CAC review copy matches the public constitution |
| `pnpm roadmap:check` | Passed; public registry and generated roadmap match |
| `pnpm build` | Passed for web, DB and API after clearing a stale failed production build cache |
| `git diff --check` | Passed |
| Visual review | Desktop 1440×1000 and mobile 390×844 captures reviewed; no horizontal overflow in checked pages; existing design retained |
| Lint | No lint script is configured in this repository; typechecks and whitespace validation ran |

Initial sandbox attempts could not access Docker or fetch the existing Google
font; reruns with access succeeded. Turbopack had retained a port-binding failure;
the old **production** build cache was preserved in a temporary folder and a
fresh standard build passed. Source/build configuration was not changed to bypass
it. Existing Node module-type warnings are non-fatal. The full unrelated browser
suite was not run; the governance suite includes existing account/export regressions.

## 10. Before CAC registration and consistency assessment

1. Have Nigerian nonprofit counsel settle the entire legal text, the three founders’
   eligibility, initial term arrangements, financial restrictions, meeting rights
   and legally valid fallback. Confirm current law, CAC forms/practice and deadlines.
2. Complete Schedule 1, the registered address, officers, names/consents and signed
   founding resolutions, keeping sensitive evidence in secured legal records.
3. Finalise objects and name approval, constitution adoption, application authority,
   publications/declarations and required incorporation evidence; submit only after
   professional clearance. This task makes no filing or payment.
4. On actual incorporation, record certificate, registered constitution/version and
   exact founding start/expiry dates; publish factual milestones with evidence.
5. Prepare the lawful admission register, equal voluntary activation and formal
   meeting procedures, independent election readiness, bank/financial controls,
   compensation separation and asset-transfer instruments before enabling them.
6. Independently verify legal elected-trustee authority and essential asset control
   before publishing a final community-control transition report.

**Consistency:** no intentional substantive inconsistency remains between the CAC
draft and community charter. They share composition, founding-term protection,
separate election cycles, retained term limits, equal voluntary participation,
legal follow-through and seven transition milestones. The website and CAC review
copy use the same constitution source; CI now checks for divergence. Supporting
policies identify where constitutional recognition is necessary.

The registered constitution does not yet exist, Schedule 1 is incomplete, and
the charter’s notice-period placeholder is deliberately not silently adopted.
Those are outstanding adoption facts/dependencies, not claims of completed legal
status. Counsel must reconcile the final adopted documents, effective dates and
any changes requested by CAC before relying on them. Historical v0.2 texts are
explicitly superseded and preserved, not current operational rules.

## Complete file inventory

### Modified existing files

- `.github/workflows/ci.yml`
- `PLAN.md`
- `PRODUCT.md`
- `README.md`
- `apps/api/src/governance/governance.service.test.ts`
- `apps/api/src/governance/governance.service.ts`
- `apps/api/src/governance/rules.test.ts`
- `apps/api/src/governance/rules.ts`
- `apps/web/app/(main)/about/page.tsx`
- `apps/web/app/(main)/charter/page.tsx`
- `apps/web/app/(main)/governance/constitution/page.tsx`
- `apps/web/app/(main)/governance/membership/page.tsx`
- `apps/web/app/(main)/governance/page.tsx`
- `apps/web/app/(main)/governance/verification/page.tsx`
- `apps/web/app/(main)/privacy/page.tsx`
- `apps/web/app/(main)/settings/page.tsx`
- `apps/web/app/ui/governance.tsx`
- `apps/web/lib/governance.ts`
- `apps/web/tests/governance.test.mjs`
- `docs/FEATURE_ROADMAP.md`
- `docs/adr/0005-governance-and-identity-groundwork.md`
- `docs/e2e.md`
- `docs/feature-roadmap.json`
- `docs/governance/identity-verification.md`
- `docs/governance/open-items.md`
- `e2e/tests/governance.spec.ts`
- `package.json`
- `packages/db/src/schema.ts`

### Added files

- `apps/web/lib/constitution.ts`
- `docs/adr/0010-nonprofit-governance-v0.3.md`
- `docs/governance/CHANGELOG.md`
- `docs/governance/IMPLEMENTATION_REPORT.md`
- `docs/governance/README.md`
- `docs/governance/cac-constitution.md`
- `docs/governance/founding-records.md`
- `docs/governance/history/README.md`
- `docs/governance/history/charter-2026-10-16.tsx.txt`
- `docs/governance/history/constitution-v0.2.tsx.txt`
- `docs/governance/implementation.md`
- `docs/governance/legal-review.md`
- `docs/governance/policies.md`
- `scripts/governance.mjs`

