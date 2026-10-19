# Governance framework — draft v0.3

19 October 2026. Proposal only; not adopted or legally operative. HeyNaija is
founder-operated; incorporation, elected representation, elected trustees and
legal community asset control are not claimed complete.

| Document | Purpose and authority |
|---|---|
| [CAC constitution](cac-constitution.md) | Proposed legal constitution for Incorporated Trustees under CAMA Part F. Generated from `apps/web/lib/constitution.ts`, exactly the text at `/governance/constitution`; counsel must approve it and complete Schedule 1 before adoption and filing. |
| `/charter` | Community Governance Charter: current service promises and proposed public democratic framework. Law and the lawfully registered constitution prevail. |
| [Founding records](founding-records.md) | Schedule 1 checklist and draft resolutions for counsel and the founding association; no actual appointments recorded. |
| [Supporting policies](policies.md) | Membership, elections, moderation independence, conflicts, finance, readiness and trustee succession. Constitutional recognition is required wherever stated. |
| [Legal review](legal-review.md) | Primary sources, filing distinctions and unresolved legal questions. Not an opinion approving the arrangement. |
| [Technical specification](implementation.md) | Existing groundwork, fail-closed admission boundary and future requirements; no feature activation. |
| [Open items](open-items.md) | Release and legal gates; all existing identity, security and youth gates remain. |
| [Identity verification](identity-verification.md) | Initial preferred NINAuth design, unavailable today. |
| [Youth safeguards](under-18-rollout.md) | Separate approval and implementation before opening under-18 accounts. |
| [Changelog](CHANGELOG.md) | History and scope of the revision. |

Run `pnpm governance:generate` after editing the shared constitution or version
metadata; `pnpm governance:check` detects divergence in the CAC review copy.
Run `pnpm roadmap:generate` after changing the feature registry.

The former constitution and founding charter are preserved as exact rendered-page
source snapshots in [history](history/README.md); they are superseded drafts,
not current rules. No incorporation facts, trustee names or completion evidence
have been invented. Publish signed legal documents and approved version identifiers
only after the necessary procedures actually occur.
