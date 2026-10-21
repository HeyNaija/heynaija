# ADR 0010 — Nonprofit governance draft v0.3 and separate legal admission

**Date:** 19 October 2026 · **Status:** Accepted for draft publication and
fail-closed preparation only; legal adoption, incorporation and activation pending.

Updates the governance assumptions in ADR 0005 without changing its feature locks.
The [framework guide](../governance/README.md) links the constitution, charter,
policies, legal-review register and implementation specification.

## Decision

- Prefer nonprofit Incorporated Trustees under CAMA Part F, subject to qualified
  Nigerian review. App membership is not association membership or incorporation.
- Three founders would be initial trustees with three-year terms proposed from
  incorporation. Community activation elects two annual representatives without
  resetting the founding term. All three trustee seats open together at expiry,
  then every three years, with equal founder eligibility and no guaranteed renewal.
  Preserve recall and two consecutive full terms per category with a one-term break.
- Separate legal admission from voluntary online participation; legal membership
  and formal meeting rights survive online opt-out. Existing restricted
  governance_memberships is only the latter. Add a legal-admission fact to pure
  eligibility rules and fail closed in the service until a lawful register exists.
  No live register, migration, appointment system or endpoint is added.
- Use the same constitution text for the website and generated CAC review copy;
  retain article anchors and historical drafts. Keep charter and policies separate
  with legal precedence and explicit constitutional dependencies.
- Expose seven separate transition phases with honest statuses and evidence gates.
  Adopt no legal deadline by code; the proposed constitution specifies preparation
  at 180 days, timetable by 90 days before expiry, and lawful formal-member fallback.
  Any caretaker arrangement requires legal basis and prior member resolution,
  maximum 90 days, non-renewable under that clause; no founder auto-holdover.
- Keep all startup locks, NIN/age/privacy/security safeguards, social networking,
  moderation independence and treasury/decision empty states. No binding ballot,
  verification, payment, donation collection or CAC automation is activated.

## Consequences and verification

The API’s own-status response shape stays compatible, with `not_legal_member`
as an additional private eligibility gap. Online participation alone cannot
become a legal admission accidentally, even in a hypothetical enabled configuration.
A separate reviewed admission register, voluntary activation lifecycle, secure
ballots and legal records are prerequisites for any future activation.

Tests cover legal admission, voluntary opt-out, the ballot freeze, separate terms
and milestones, public draft/status explanations and CAC-copy consistency.
`pnpm governance:check` prevents drift. The current registered constitution does
not exist yet; the generated document is a review copy with unresolved schedules.
Rollback of this revision requires no database migration; feature locks stay.
