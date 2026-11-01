# ADR 0018 — Age verification: how a member proves they are an adult

**Date:** 31 October 2026 · **Status:** Proposed, design only. Nothing is built:
no schema, no migration, no endpoint, no provider account, no UI. ·
**Roadmap:** `age-verification` (blocks `direct-messages`, and through it
`calls-and-meetings`) · **Related:** [ADR 0006](0006-age-status-model.md),
[ADR 0016](0016-direct-messages.md), [ADR 0017](0017-calls-and-meetings.md),
`docs/governance/under-18-rollout.md` section 2,
`docs/governance/open-items.md` sections 2 and 3

Nothing here is legal advice. Every legal point is for Nigerian counsel
(section 8). Every outside fact has a source and a retrieval date in the Sources section.
Anything marked **(unverified)** could not be confirmed from a primary source on
31 October 2026 and must be checked before it is relied on. Prices change.

## Decision (recommended)

Use a **hosted document-and-selfie check from a provider with real Nigerian
document coverage, run only when a member chooses to verify, and keep three facts
about the result: when, which provider reference, and the band (`18_plus`).** Never
the document, the selfie, the date of birth or the document number.

- **Recommended: Smile ID**, because it is the only candidate whose published
  documentation lists Nigerian driver's licence, passport, voter's card and
  national ID as document types, and it also does government-database NIN and BVN
  lookups. **Its price is not published, so this is conditional on a written
  quote, a data processing agreement and the answers in section 8.**
- **Runner-up: Didit**, which publishes prices (about $0.33 per full check, 500 free
  a month, $0.10 for age estimation only, NIN $0.20 and BVN $0.35 by database
  lookup). It is cheapest and the easiest to try on staging. Its depth on Nigerian
  documents, accuracy on Nigerian faces and data residency are unverified.
- **Not recommended as the only route: facial age estimation alone** (Yoti and
  similar). It gives an estimate with a margin of error, not a proof, and nobody
  has published accuracy for Nigerian faces that I could find. It is good as a
  cheap first step in front of a document check later, not as the `verified` level.

The seam stays as ADR 0006 built it: one provider writes an `age_assurances` row
with `method = 'age_assurance_provider'`, and `ageStatus()` / `isAdultFor()` do
the rest. What changes is described in section 5.

## Context

- **Why this is needed.** ADR 0016 (owner decision, 30 October 2026) makes
  direct messages, and through ADR 0017 calls and Gists, available only to members
  who are 18 or over **and age-verified**. In the code, "verified" means the
  assurance level `verified` in `apps/api/src/governance/age.ts`: a statement made
  by `identity_provider` or `age_assurance_provider`. Today **no member can have
  it**: every adult is `declared` at best, and `age_assurance_provider` has no
  writer.
- **Why the NIN route is not the answer.** NIN verification
  (`NIN_VERIFICATION_ENABLED`) is locked off in `apps/api/src/env.ts` (`lockedOff`,
  which refuses to start if set to `true`). The reason is written in
  `docs/governance/open-items.md` section 3: HeyNaija is not yet an approved
  NINAuth partner; NIMC has not confirmed the claims the code assumes (a stable
  pseudonymous subject, an over-18 claim, result lifetime, scopes); there is no
  data protection impact assessment (DPIA); `/privacy#identity` is not written;
  the `restricted` schema still lacks its own database role and column
  encryption; and `IDENTITY_KEY_SECRET` does not exist. Those are all about
  *identity* for voting. Age is a smaller question, and the under-18 rollout doc
  (section 2) says the age provider "must not require a NIN".
- **Why under-18 accounts are locked.** `UNDER_18_ACCOUNTS_ENABLED` is locked off
  until `docs/governance/under-18-rollout.md` is approved and built (ADR 0006,
  decision 1). This ADR only has to prove "adult"; it never writes `under_18`.
- **Constraints from the product.** Members are in Nigeria and the diaspora;
  phones are low-end Android on patchy data (`apps/web/DESIGN.md`); the pilot is
  small (the cost model uses 200, 2,000 and 20,000 verified members); the people
  running it are not a company with a compliance team. The check must work in a
  mobile browser (there is no native app), must not ask anyone to post
  documents publicly, and must be optional: a member who never verifies loses
  only the features that need it.

## 1. Options

### Option A: Nigerian KYC provider, document plus selfie (recommended family)

The member photographs an ID and takes a selfie in a hosted flow; the provider
checks the document, matches the face and returns a result including a date of
birth. We keep only "18 or over".

| | Smile ID | Didit | Dojah / Prembly (IdentityPass) / Youverify |
| --- | --- | --- | --- |
| Proves | DOB from document or database, then our band | DOB from document or database, then our band; also age estimation only | Same family: DOB from document or NIN/BVN lookup |
| Nigerian coverage | Documents: driver's licence, national ID, passport, voter's card, registration certificate, resident ID, travel document (docs, retrieved 31 Oct 2026). Database ID numbers: NIN, BVN, phone, voter's number (country page) | NIN and BVN database lookup priced; document coverage for Nigeria not checked **(unverified)** | Youverify lists driver's licence, ID card, passport, voter ID; others **(unverified)** |
| Data it needs | Document images, selfie, ID number if database route | Document images, selfie, or NIN/BVN number | Same |
| Who stores it | Provider, for a period set by contract **(unverified)** | Provider; retention "enterprise" setting, no figure published | Provider **(unverified)** |
| Price per check | **Not published**; sales-quoted | **$0.33** full check after 500 free a month; $0.15 ID only; $0.10 age estimation; NIN $0.20, BVN $0.35 (pricing page, 31 Oct 2026) | Prembly: "from $0.50" on its page, a blog says about $0.12 (conflict); Dojah "from $0.06 per call" per a competitor's blog, NIN/BVN not itemised; Youverify: not published |
| Latency | Not published | Not published | Not published |
| Mobile web SDK | Yes, web and mobile SDKs (vendor page, retrieved via search) | Hosted flow, details **(unverified)** | Dojah and Youverify have web SDKs **(unverified)** |
| Data residency | Not verified | "Enterprise" option only | Not verified |
| Bias for Nigerian faces | Vendor says debiased; no figures found **(unverified)** | None found | None found |

Notes. Smile ID's documentation lists `DRIVERS_LICENSE`, `IDENTITY_CARD`,
`PASSPORT`, `REGISTRATION_CERTIFICATE`, `RESIDENT_ID`, `TRAVEL_DOC` and
`VOTER_ID` for Nigeria, and not a separate NIN-slip type. NIN slips are the
paper most Nigerian adults actually have, so a document route that rejects them
leaves the NIN or BVN database route as the way in for many members (see Option B).

### Option B: Government-database lookup with selfie match (NIN or BVN)

The member gives a NIN or BVN; the provider asks NIMC or NIBSS and compares the
selfie with the photo on record, returning a DOB. This is the route most
Nigerian adults can complete, because nearly everyone has a NIN or a BVN.

- **A number alone is not proof.** NINs and BVNs are not secret enough: a
  lookup of someone else's number with no face match would "verify" anyone. It
  must be paired with a selfie match to the registry photo, or with an OTP to the
  phone number registered to that BVN **(unverified how each provider does it)**.
- **Cost.** Published: Didit NIN $0.20 and BVN $0.35 per answered attempt;
  Monnify BVN ₦10 and NIN ₦60 per check (a vendor's page seen via search, not
  opened); resellers ₦30 to ₦250 (not opened). Smile ID, Dojah, Prembly and
  Youverify: not published.
- **Policy conflict.** The rollout doc says the provider must not *require* a
  NIN. A provider that offers the NIN lookup as one of several routes does not
  require it, and the provider, not HeyNaija, holds the NIMC access. Direct NIMC
  access needs a formal request and an MOU (NIMC verification service page) and
  is the NINAuth work still locked in `open-items.md`. **Do not go direct.**
  Whether a provider-run NIN lookup is acceptable alongside the locked NIN flag
  is a question for counsel and the owner (section 8, question 3).
- **A NIN lookup only returns what NIMC holds.** Members who enrolled with a
  wrong date of birth fail, with no way for us to fix it (section 6).

### Option C: Global document-and-selfie providers (Veriff, Persona, Onfido/Entrust, Incode)

Same shape as A, built for the US and EU. Veriff publishes self-serve prices:
Essential **$0.80** per verification ($49 monthly minimum, 3 months retention),
Plus $1.39 ($99 minimum), Premium $1.89 ($209 minimum), retries not billed, with
a self-serve cap of 10,000 sessions a month (Veriff page, 31 Oct 2026). Persona:
per-check price not published (a third party cites a $250 monthly start; that is
not a per-check price). Onfido/Entrust and Incode: not checked. Nigerian
document coverage for all of these: **not confirmed** from the vendors' own
pages (Veriff's help page lists document types only in general). Data
residency: Veriff's page gives no region. Choose these only if A fails; they
cost three to eight times Didit and cover Nigeria less certainly.

### Option D: Facial age estimation only (Yoti and others)

A selfie is run through a model that returns an estimated age; no document, and
the provider says it keeps no image. Cheap and fast for the member.

- **What it proves.** "Looks at least N", not an exact age. Yoti's published
  mean absolute error is 1.1 years for ages 13 to 17 and 2.4 across 6 to 70 (Yoti
  white paper, July 2025, vendor-reported). NIST (via a third-party review) put the
  error for 18-year-olds at about 2.6 to 2.9 years. So the provider sets a buffer:
  to accept 18 with low risk you refuse anyone estimated under about 21 to 25 and
  send them to a document. Adults who look young are therefore always pushed to
  Option A or B.
- **Nigerian faces.** Yoti publishes a skin-tone breakdown on a 1 (lightest) to 3
  (darkest) scale: for females 13 to 17 the mean error is 1.0, 1.2 and 1.5 years
  for lightest to darkest; 13 to 17 true-positive rates 99.6%, 99.0%, 98.9% (fact
  sheet and white paper, vendor-reported). **I found no figure specific to
  Nigerian or West African faces from anyone.** The darkest-tone gap is the
  group HeyNaija serves, so assume it is worse than the headline.
- **Price.** Yoti: not published (quote only). Didit: $0.10 per estimate (a
  competitor's price, not Yoti's).
- **Abuse.** Easily beaten by a borrowed face, an edited selfie or an injected
  video (section 4). A July 2026 study of seven models found simple changes such
  as stubble, a moustache or make-up could shift the estimate.
- **Use.** A free or cheap first filter in front of A. Not `verified` on its own,
  because a lawyer asked "what did you do to confirm 18?" would be answered "a model
  guessed".

### Option E: Approaches without a document or face

None of these has a Nigerian price or coverage I could verify; each is assessed
on what it proves.

- **Self-declaration with a parental flow.** Proves nothing about the adult; it is
  what we have today (`declared`). A parental-consent flow is a different job
  (under-18 rollout section 3). Not a `verified` level.
- **Payment-card check.** A card shows someone with a bank relationship; it does
  not show 18, because Nigerian banks issue cards to teenagers' accounts **(unverified)**,
  and a card costs money and excludes members without one. Weak. Not recommended.
- **Phone carrier or SIM registration data.** SIM registration is tied to NIN
  (NCC FAQ) but we know of no carrier API returning "over 18" to a third party,
  and sharing it would need a lawful basis the carrier would resist **(unverified)**.
  Not available.
- **BVN with OTP** is Option B.
- **Trusted-community vouching** (a few verified adults vouch for a new member).
  Cheap and fits HeyNaija's community shape, but it proves only that the
  members trust each other: a teenager among adult friends gets vouched. It also
  puts adults at legal and social risk for others' ages. It belongs in the
  *appeal* path (section 6), never as the primary `verified` route.
- **Moderator review** is already modelled as `reviewed`, and ADR 0016 rules it
  out for DMs: a correction mechanism, not a check anyone can audit.

## 2. Cost model

Verification is a one-off per member (an adult does not become a non-adult), so
the cost is attempts, not months. Assumption (mine, to be replaced by a trial):
**1.3 billed attempts per verified member** for providers that charge per
attempt (some failures are retries); Veriff does not bill retries, so its row uses
1.0. USD only; naira would be the USD figure times whatever rate applies on the
day, which I have not assumed. Price inputs are in section 1 and the Sources section.

| Cost to verify (one-off) | 200 members | 2,000 | 20,000 |
| --- | --- | --- | --- |
| Didit full check, $0.33, nothing free | $86 | $858 | $8,580 |
| Didit full check, with 500 free a month (cumulative signups spread over 6 months or more) | about $0 | about $0 to $400 | about $8,000 |
| Didit age estimate only, $0.10 | $26 | $260 | $2,600 |
| Didit NIN lookup, $0.20 | $52 | $520 | $5,200 |
| Veriff Essential, $0.80 | $160 (the $49 monthly minimum applies) | $1,600 | $16,000 (above the 10,000 sessions a month self-serve cap if signups bunch; enterprise quote) |
| Veriff Premium, $1.89 | $378 | $3,780 | $37,800 |
| Smile ID, Dojah, Prembly, Youverify, Persona, Yoti | **not published** | | |

Reading it. At the pilot sizes the money does not decide the choice: even
Veriff Premium is under $400 at 200 members. At 20,000 it is $8,000 to $38,000 a
year-equivalent, which is large for a nonprofit, so we negotiate volume pricing
with Smile ID before 2,000 and compare it to Didit's. Operator time, review of
refused members and provider support are real costs not modelled. Re-verification
(for example after a lapse) is extra and not modelled.

## 3. Compliance with the Nigeria Data Protection Act 2023 (NDPA) and NDPC rules

I could read the NDPC's General Application and Implementation Directive
(GAID 2025) text in this session, but not the Act itself (the PDF host refused
access). Section numbers for the Act below are from secondary summaries and are
**unverified**; GAID article numbers are from the primary text.

- **Lawful basis.** GAID Article 18(1) requires consent for sensitive personal
  data, for a child's data, and before transfer to a country the Commission has
  not found adequate. A face match uses biometric data; the Act defines
  biometric data used to identify a person as sensitive **(unverified section)**.
  Our check is optional, so **explicit, withdrawable consent** is both workable
  and the safest basis. Consent text should be versioned like
  `identity_verifications.consentVersion`.
- **Data minimisation and storage limitation** are NDPA principles
  **(section unverified)**: the design in section 5 follows them.
- **Children.** GAID Article 18 requires consent for children's data, and one
  secondary guide says the GAID defines a child as under 18 while the Act sets 13
  for digital consent; those conflict and need counsel. Relevant here: a
  *refused* check may be a child's selfie, so the provider's deletion of failed
  attempts matters.
- **Cross-border transfer.** The member's selfie and document leave Nigeria
  if the provider processes abroad. The Act's transfer section (reported as
  s.41 to 43, unverified) and GAID Schedule/DPIA rules apply; a secondary
  source says GAID makes transfers high-risk and requires a DPIA first and that the
  earlier adequacy whitelist no longer has legal effect. Ask each provider where
  processing and storage occur. A Nigerian-registered provider processing in
  Nigeria is simpler but **not verified for any candidate**.
- **DPIA.** The GAID's own assessment form asks "Do you have an effective means
  of carrying out age verification?" for any processing involving a child's data.
  A DPIA is needed regardless: it is already an open item for NIN
  (`open-items.md` section 3), and biometric processing and transfers both
  trigger one. **No live check before the DPIA is reviewed.**
- **Controller and processor.** HeyNaija is the controller; the provider is a
  processor, or in some products an independent controller. A data processing
  agreement (GAID Article 34) naming purpose, retention, location and deletion
  is a precondition. If a provider acts as its own controller, say so in the
  privacy page.
- **Registration with the NDPC.** Whether HeyNaija, as a data controller of
  major importance, must register is outside this ADR; the operator is still a
  placeholder (`open-items.md` section 1).
- **Privacy page.** `/privacy#identity` (placeholder today) needs a section for
  age checks: what, why, basis, recipient, location, retention, rights.

## 4. Abuse resistance

| Attack | Option A/B (document + selfie) | D (estimate only) |
| --- | --- | --- |
| Teenager uses a parent's or sibling's ID | Face match blocks it unless they look alike; a registry photo can be years old | Passes with a parent's face if the selfie is borrowed |
| Photo of a photo, screen, mask | Liveness (passive or active) catches most | Same, weaker |
| Deepfake injected into the camera feed | Needs injection-attack detection, offered by only some vendors **(unverified per vendor)** | Same |
| Altered or counterfeit document | Document authenticity check | n/a |
| One adult verifies many accounts | **Not stopped by us** if we keep no document identifier; provider duplicate detection **(unverified)** | Not stopped |
| NIN or BVN number of a stranger | Blocked by the selfie or OTP match; **not** blocked if the route is number only | n/a |

Evidence: Yoti's CEO argues a digitally literate teenager can stage a simple
injection attack (Biometric Update, April 2026), a May 2026 study (reported) found
many minors defeated checks within minutes with borrowed faces, VPNs and edited
or generated selfies, and a July 2026 study concluded face age estimation "should
remain a component of a broader verification process". These are vendors' and
journalists' reports. **No source I found tested a parent's Nigerian ID.**
Accept that no remote check is proof; the layered defence is: a real check, then
reports, then the existing moderator process (`reviewed` can *withdraw* a bad
verified row, see section 5).

## 5. Data-minimisation design (whichever provider wins)

**What we store**, in `restricted.age_assurances` (ADR 0006), one row per success:

| Field | Value |
| --- | --- |
| `band` | `18_plus` (never `under_18` from this path) |
| `method` | `age_assurance_provider` |
| `assuredAt` | the `ageVerifiedAt` time |
| `provider` (new, text) | for example `smileid` |
| `providerRef` (new, text) | the provider's job or session id, so we can ask them to delete it or answer an appeal |
| `withdrawnAt` | existing |

Nothing else: no selfie, no document image, no document number, no date of
birth, no name from the document, no raw provider response. If the provider
returns a mismatch or an under-18, we record **no** under-18 row (the rollout doc
says below-minimum is refused with no age record) and keep only a short
`age_verification_attempts` count per member for rate limiting (counter and
last attempt time, deleted with the account).

**Where the data lives while the check runs.** The member's browser talks to the
provider's hosted flow or SDK; images go from the phone to the provider and
never through our API or storage. We receive a signed webhook (or fetch the
result with a server key) containing a pass/fail and a band; the handler checks
the signature, the reference and that the over-18 result belongs to the member
who started it (a state value we generate), then writes the row.

**Retention at the provider.** Set to the shortest the contract allows
(Veriff Essential's default is 3 months; Smile ID and Didit: **unverified**),
with deletion on request through their API. Our contract must say how and when
images and the biometric template are deleted, and that they are not used to
train models.

**Retention with us.** The row is kept while the account exists, because it is
the live proof; a withdrawn row is kept as history (ADR 0006), except on
account deletion.

**Deletion on account deletion.** Delete the member's `age_assurances` rows (all,
including withdrawn), call the provider's delete API for each `providerRef`,
and delete the attempts counter. The existing account-deletion process (30-day
window, confirm in code) runs this. A deletion failure at the provider goes
to a retry queue and an operator alert; the member is told in `/privacy`. This
conflicts with "history" in ADR 0006 and needs counsel to settle for fraud and
safeguarding records.

**The API seam.** Today the only age test is `isAdultFor(ageStatus(records), purpose)`.
ADR 0016 adds a purpose; this ADR names the wrapper:

```ts
// ADULT_ASSURANCE_REQUIRED gains: direct_messages: 'verified'
isAgeVerifiedAdult(memberId): Promise<boolean>
// = isAdultFor(await ageStatusOf(memberId), 'direct_messages')
```

It reads live rows on every call, never caches across requests, and returns false
when the feature flag is off, when nothing is on record and for `reviewed` or
`declared` only. Routes, `canMessage` and `canCall` call it; nothing reads
`provider` or `providerRef`. `GET /v1/me` exposes only a yes/no for the member's
own state.

**Revocation.** An operator or a moderator who finds a verified member is a minor
withdraws the row (`withdrawnAt`), after which `ageStatus` falls back to
`declared`, matching the lapse rules in ADR 0016 section 2. The "mistaken-age
hook" ADR 0016 names (a way to withdraw a verified row) is a part of this work.

**Duplicate use.** The strict-minimum design keeps nothing that detects one adult
verifying ten accounts. The alternative is an HMAC of the document number kept
as `person_key` for the age provider, like `identity_verifications.personKey`;
that is still personal data (`open-items.md` section 2) and moves us toward the
identity records we are avoiding. **Recommendation: do not keep it, rely on the
provider's duplicate flag if it has one, and cap attempts.** Open question 5.

## 6. Failure, retries and appeals

- **Refused (under 18 or low confidence).** Say "We could not confirm your age.
  Your messages stay off. You can try again with a different document."
  Never say "you are under 18". Nothing is recorded as under-18.
- **Retries.** Three attempts a day, ten a month, per member, enforced on our
  side (add to `LIMITS` in `apps/api/src/rate-limit.ts`) so a refusal cannot be
  ground down.
- **A wrongly refused adult.** Typical causes: a NIN record with a wrong date of
  birth, an expired document, a camera too poor for liveness. Routes: another
  document or route (A then B), then provider manual review if offered
  **(unverified)**, then an appeal to the safety contact (placeholder in
  `/rules#appeals`). A human may **not** mark someone `verified` by moderator
  decision (that is `reviewed`, and ADR 0016 rules it out). An appeal either
  re-runs the provider check with support's help or is declined.
- **Wrongly accepted.** The usual moderation path: report, review, withdraw the
  row, notice and appeal.
- **Member without any usable ID.** Many Nigerians have only a NIN slip or
  nothing physical. Route B covers them; those with no registry record do not
  get DMs. We accept that cost. Say so in the privacy copy and Settings.
- **Outages.** Provider down: the Verify button shows a plain error, nothing
  else breaks. No fallback to `declared`.

## 7. Rollout (existing feature-flag pattern)

New flag `AGE_VERIFICATION_ENABLED`, default `false` in every environment,
plus an allow-list `AGE_VERIFICATION_MEMBERS` (handles) like
`DIRECT_MESSAGES_MEMBERS`. It is *not* `lockedOff`: the age rule lives in code
(the table writer and `isAgeVerifiedAdult`), so the flag may be switched on once
the steps below are met, but a test must fail the build if the provider writer
can create `under_18` or if the flag is on with no webhook signature check.
`NIN_VERIFICATION_ENABLED` and `UNDER_18_ACCOUNTS_ENABLED` stay locked and are
untouched.

1. **Decide.** Owner picks the provider on the basis of a written quote from
   Smile ID and a Didit trial; counsel answers section 8.
2. **DPIA and contract.** DPIA drafted and reviewed; data processing agreement
   signed; `/privacy#identity` drafted. Nothing live before these.
3. **Build behind the flag** (staging only): schema (two columns and the attempts
   counter), webhook, `isAgeVerifiedAdult`, rate limits, deletion hook, Settings
   "Verify your age" button, tests first. The provider's **sandbox** and team
   members' own documents only; no real member data on staging.
4. **Staging allow-list:** five named adults, including at least one who must be
   refused (a team member, with their consent, using a document they are not
   entitled to) and one who needs route B. Measure completion rate on a
   low-end Android over mobile data.
5. **Production allow-list** of named adults, two weeks. Watch completion rate,
   refusal rate, appeals and provider cost per verified member.
6. **Public** for any adult who chooses to verify. DMs (ADR 0016 rollout step 5)
   then follow on their own flag. Roadmap `age-verification` moves to Implemented
   only after the owner confirms it in production.

## 8. What I would want a lawyer to confirm

1. The lawful basis and consent wording for a face match, and whether an
   optional age check counts as sensitive-data processing.
2. Cross-border transfer: what is needed for a provider that processes outside
   Nigeria, and whether the GAID DPIA must be filed with the NDPC.
3. Whether a provider-run NIN or BVN lookup (Option B) is acceptable while our
   own `NIN_VERIFICATION_ENABLED` is locked, given the rollout doc line "must not
   require a NIN", and whether NIMC or NIBSS terms restrict a reseller's
   customers.
4. Retention and deletion: whether withdrawn rows may be kept as history, and
   for how long a provider may keep a failed attempt.
5. Whether "verified adult" for DMs is a standard the NDPC or the NITDA Code of
   Practice would call "appropriate age verification", and what happens to
   children's data in a refused selfie.
6. What a published retention and scanning policy must say (rollout doc section 5).
7. The age of a child under the NDPA and GAID (13 or 18; sources conflict).
8. Who the controller is: the operator is still a placeholder.
9. Duty to the member if a provider has a breach (GAID Article 33).
10. Whether diaspora members' own country law (for example UK or EU) adds duties.

## Consequences

- Almost no stored data and no new identity records; HeyNaija's exposure if the
  database leaks is "this account was verified by X on date Y".
- Verified status depends on a third party and its uptime, price and policy.
  Changing provider later means asking members to verify again, unless the
  `provider` column and a second writer let both coexist (they do).
- Members without a registry record or a usable ID cannot use DMs or calls.
- Without a stored document identifier we cannot prevent one adult verifying
  several accounts.
- Cost scales with members at $0.33 or more each; negotiate before 2,000.
- No code change to `NIN_VERIFICATION_ENABLED` or `UNDER_18_ACCOUNTS_ENABLED`.
- Staging needs a provider sandbox account and care that no real document is used.

## Open questions

### Questions for the team to answer

Answer under each question (edit this file in a PR, or reply on the PR and the
answer gets written back here). Each has a recommendation so "agreed" is a
complete answer. Until questions 1 to 3 and 6 are answered nothing in this ADR is
accepted, and the age check stays a placeholder (the `CALLS_MEMBERS` allow-list).

1. **May a provider run a NIN or BVN check as one optional route while our own NIN
   verification is locked?** The rollout doc says the age provider "must not
   require a NIN". Recommendation: yes, as one optional route and never the only
   one, subject to counsel's confirmation (section 8, question 3).
   - Answer:
   - Answered by / date:

2. **Must the data stay in Nigeria, or is Africa or elsewhere acceptable with the
   right agreements?** Recommendation: not a hard rule; prefer Nigerian or African
   processing, and ask each provider where it processes and stores before choosing.
   - Answer:
   - Answered by / date:

3. **Do we accept that members with no usable ID or no registry record cannot use
   DMs or calls?** Recommendation: accept it for now (those features are optional
   and everything else keeps working), and revisit if many members are affected.
   - Answer:
   - Answered by / date:

4. **Who answers age-verification appeals, how fast, and what is the safety contact
   address?** Needs the moderator runbook (ADR 0016 open question 8).
   Recommendation: a named moderator, first reply within 2 working days, and a
   dedicated safety address that is not a personal inbox.
   - Answer:
   - Answered by / date:

5. **Should HeyNaija pay for the checks, so members pay nothing?**
   Recommendation: yes, because charging for a safety gate shuts out the members it
   protects; the cost model (section 2) shows the cost at 200, 2,000 and 20,000
   verified members, and the opt-in keeps it to people who want DMs or calls.
   - Answer:
   - Answered by / date:

6. **Provider: Smile ID (recommended, price unpublished) or Didit (price published,
   Nigerian coverage unverified), and do we run a trial on staging first?**
   Recommendation: get a written quote from Smile ID, then run the same five people
   through both on staging before choosing.
   - Answer:
   - Answered by / date:

### Smaller open items

- **Retention at the provider.** Recommend the shortest the provider offers;
  confirm the numbers when we have a quote.
- **Keep a document-derived key to stop one adult verifying many accounts?**
  Recommend no (section 5); revisit if abuse shows up.
- **Roadmap.** `age-verification` notes remain accurate; add this ADR to its
  evidence when this is accepted. ADR 0017 still calls ADR 0016 "PR #42, not yet on
  `staging`"; that is now out of date.

## Sources (retrieved 31 October 2026)

- Didit pricing: https://didit.me/pricing/ (prices above)
- Veriff self-serve plans: https://www.veriff.com/plans/self-serve
- Smile ID Nigeria document types: https://docs.usesmileid.com/id-coverage/verify-with-document/africa
- Smile ID Nigeria country page: https://smile.id/countries/nigeria; supported documents https://smile.id/supported-documents
- Deepidv comparison saying Smile ID rates are not public: https://www.deepidv.com/compare/smile-identity
- Dojah/Prembly/Youverify price comparison (a competitor's blog, treat with care): https://www.ninja.ng/blog/dojah-prembly-youverify-ninja-pricing/
- Prembly pricing: https://prembly.com/pricing/
- Monnify identity verification: https://monnify.com/products/identity-verification (seen via search, not opened)
- Yoti accuracy and skin tone: https://cdn.aws.yoti.com/wp-content/uploads/2026/01/Yoti-Age-Estimation-White-Paper-July-2025-PUBLIC-v1.pdf and https://cdn.aws.yoti.com/wp-content/uploads/2025/07/Facial-age-estimation-fact-sheet.pdf (vendor-reported, via search summaries)
- Yoti price (quote only): https://www.yoti.com/business/age-verification/; benchmark: https://didit.me/blog/didit-vs-yoti/
- Injection attacks: https://www.biometricupdate.com/202604/deepfakes-are-a-threat-to-age-assurance-and-injection-attack-detection-is-the-answer; face age estimation manipulation study: https://www.biometricupdate.com/202607/basic-visual-manipulations-can-fool-some-fae-but-theres-a-solution-says-study
- NDPC GAID 2025 (Article 18 and the DPIA form, read from the PDF): https://ndpc.gov.ng/wp-content/uploads/2025/07/NDP-ACT-GAID-2025-MARCH-20TH.pdf
- NDPA and GAID summaries (secondary, unverified section numbers): https://privacymatters.dlapiper.com/2025/06/nigeria-ndpc-issues-gaid-key-compliance-insights/ and https://www.balogunharold.com/insights/nigeria-data-privacy-law-2025-ndpa-gaid-guide
- NIMC verification service: https://nimc.gov.ng/nimc-verification-service
- Not retrieved: the NDPA text itself (https://cert.gov.ng/ngcert/resources/Nigeria_Data_Protection_Act_2023.pdf returned 403).

**Could not verify:** every Smile ID, Dojah, Youverify, Persona, Yoti, Onfido and
Incode per-check price; latency for any provider; data residency for any
provider; Nigerian-face accuracy for any model; the NDPA section numbers;
whether any provider offers injection-attack detection or duplicate detection;
the VASP claim and the "NIMC discontinued NIN verification" claim (a vendor
blog, unconfirmed); exchange rate; card, carrier and BVN-OTP behaviour in Nigeria.
