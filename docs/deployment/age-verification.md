# Age verification with Didit: setup

The design is [ADR 0018](../adr/0018-age-verification.md) (on the `docs/age-verification`
branch until it merges). This page is the setup. What is built: a member chooses
**Verify your age** in Settings, is sent to a Didit-hosted check, and the result comes
back by webhook (or by polling). HeyNaija keeps the outcome only.

Facts about Didit below are from its docs as read on 1 November 2026
(`docs.didit.me`: sessions-api/create-session, sessions-api/retrieve-session,
integration/webhooks). Re-read them when changing the integration; the code was written
against them and never run against the live API.

## What is stored

One row per member in `restricted.age_verifications`: `status` (`pending`, `in_review`,
`verified`, `declined`, `expired`), `method` (`document`, `age_estimation` or `didit`,
set on approval), `verified_at`, `didit_session_id`, `outcome` (a short code saying why a
result was declined, for support, never shown to the member) and `person_key`. Never the
document, the face, a date of birth, a name, the document number, Didit's payload or its
hosted URL. The row goes when the account does (`ON DELETE CASCADE`).

**`person_key`: a salted person identifier, and why.** For an approval by document check, a
keyed HMAC-SHA256 is stored of the issuing country and the document number (upper case,
spaces and punctuation removed). It is keyed with `IDENTITY_KEY_SECRET` (the same secret and
`derivePersonKey` helper as the NIN person key in `governance/rules.ts`, with its own label so
the two cannot collide). The number itself is read from Didit's decision, turned into the key
and dropped; it is not stored, logged or returned. The key exists for one reason: a unique
index (`age_verifications_person_idx`, where status is `verified`) lets one document hold one
verified account, so one adult cannot verify a string of accounts with the same ID. It is
personal data: it lives in the `restricted` schema, is never returned by any API or put in an
export, and needs the same care as `identity_verifications.person_key`.

Limits to know:

- **Age-estimation approvals have no document**, so they store no key and are not checked for
  duplicates. If the workflow can approve by estimation alone, one face can still verify
  several accounts that way (the Face Search settings in step 2 are the only guard).
- **A document approval Didit sends without a readable number is declined** (`outcome`
  `no_document_number`): without a number it cannot be told apart from anyone else's.
- **Deleting the account deletes the key**, so a person who deletes an account can verify
  another with the same document. Nothing keeps a record of a deleted account.
- **Whoever verifies first with a document holds it.** If someone else verifies with your
  document first (a stolen or borrowed ID), you, the real owner, are declined as
  `duplicate_person` and see only "Not verified, try again". That is inherent to any
  one-document-one-account rule. The key is deliberately not kept on declined rows, so the
  declined row alone does not say who the holder is.

  *Support runbook.* (1) Find the holder: in the Didit console, the declined session's
  duplicate match points to the other session (and its `vendor_data` is the holder's member
  id); or derive the key from the owner's document number with `IDENTITY_KEY_SECRET`
  (`documentPersonKey` in `person-key.ts`: issuing country, then the number) and look for it
  in `restricted.age_verifications.person_key`. (2) Reverse the holder's approval in Didit.
  The webhook turns `verified` into `declined`, which clears the key. (3) The owner starts a
  new check.
- **A new document is a new key**: a renewed passport or a second kind of ID (passport,
  then driver's licence) is a different number, so the same person can verify again with it.
- **Rotating `IDENTITY_KEY_SECRET` breaks the check for existing results**, since new keys
  no longer match old ones. Do not rotate without a plan (open-items.md).

## Setup steps

1. **Didit console** (business.didit.me): create an application. Start with the sandbox
   one; its sessions can be armed with scenarios (`sandbox_scenario`) so approved and
   declined can be tried without a real ID.
2. **Workflow**: create a KYC workflow that decides whether the person is 18 or over, for
   example ID verification with a minimum-age rule, or age estimation (the ADR prices both).
   HeyNaija treats Didit's `Approved` as "an adult", so the 18+ rule must live in the
   workflow: a workflow that approves every real ID would verify minors. Copy the workflow
   id.

   **Required, so that one adult cannot verify many accounts:** turn **Face Search** on, set
   the duplicated-face actions (`DUPLICATED_FACE`, `POSSIBLE_DUPLICATED_FACE`,
   `FRONT_CAMERA_DUPLICATED_FACE`) and the document duplicate action to **DECLINE**, and set
   the application's `duplicated_user_action` to **DECLINE**. Do **not** build the workflow
   from Didit's ISO/IEC 27566-1 age-assurance templates: they switch the duplicate checks
   off. Check this on the sandbox before any live use. This stops the same face or document
   being used again; it cannot stop an adult from completing the check for several accounts
   in turn if each uses a different person or document, and nothing a provider offers can
   (the code's duplicate rule below is only a backstop).
3. **API key**: create one with the `read:sessions` privilege (needed for the decision
   fetch) and permission to create sessions.
4. **Webhook destination** (API and Webhooks): URL `https://<site>/api/v1/webhooks/didit`
   (the web app proxies `/api/v1` to the API, so no nginx change), subscribed to
   `status.updated` only. Copy the destination's **secret** (`secret_shared_key`). If the
   site is behind Cloudflare with rules that block unknown senders, allow Didit's address
   (18.203.201.92 at the time of writing).
5. **Environment** (`infra/deploy/.env`, local `.env`): `DIDIT_API_KEY`,
   `DIDIT_WORKFLOW_ID`, `DIDIT_WEBHOOK_SECRET`, and `IDENTITY_KEY_SECRET` (32 or more random
   characters, `openssl rand -hex 32`; store it in the password manager). It keys the
   duplicate-document check below and is the same secret NIN verification will use, so
   generate it once. Restart the API.
6. **Flag**: `ageVerification` is on in development and staging and off in production. In
   production an admin turns it on from Moderation, Feature flags, first as an allow-list
   of a few named members ([feature-flags.md](../feature-flags.md)).

Callback address (sent with each session): `<WEB_PUBLIC_URL>/settings/age-verification`.
That page reads the result from the API; the `status` Didit appends to the address is not
used.

## Behaviour to know

- **Fails closed.** With any of the four settings missing (the three Didit ones and
  `IDENTITY_KEY_SECRET`), no check is offered
  (`GET /v1/me/age-verification` says `available: false`), `POST .../session` answers 503,
  and the webhook answers 404. The API still starts. A missing webhook secret never means
  "accept anything".
- **Webhook checks.** `X-Signature-V2` only: HMAC-SHA256 (hex) of the parsed body with
  sorted keys, compact separators and Unicode kept, compared in constant time, accepted
  also from `X-Signature-V2-Previous` for the 24 hours after a secret rotation.
  `X-Timestamp` is not covered by the signature, so on its own it stops nothing; it must be
  within 300 seconds of now **and equal to the signed body's own `timestamp`**, which makes
  the window bind the body (an old body sent again with a fresh header is refused). That
  is the limit of replay protection: Didit itself re-signs retries and manual resends with a
  fresh timestamp, so a replay inside the window, or a legitimate resend, is accepted. What
  makes that harmless is the next point. `X-Signature-Simple` is never
  accepted, because it does not cover the decision. The docs list `X-Signature` (raw
  bytes) as an alternative; it is not used.
- **Whose result.** The session id must be the one stored for the member named in
  `vendor_data` (the member id). Any other session, an old one, or a delivery for nobody
  is accepted and ignored.
- **The webhook is a signal, not the truth.** After the signature and session checks the
  API fetches the session's decision from Didit and applies **that** status, never the one
  in the webhook body. So a retried or resent old `Approved` cannot bring back an approval
  that was reversed: Didit's current answer wins. If the fetch fails the webhook answers 503
  and Didit retries (about 1 and 4 minutes later); it never answers 2xx and drops the event.
- **Order.** A result never moves back on a stale event (a late `In Review` cannot undo an
  approval). Two moves are deliberate and come only from Didit's current decision: a
  reviewer in Didit's console can approve a declined or expired session, and can reverse an
  approval.
- **One document, one account.** If the key of an approved document already belongs to
  another member's verified row, this member's result ends `declined` (`outcome`
  `duplicate_person`), on webhook and polling alike. The member is told only "Not verified,
  try again"; neither the person nor the other account is named in the response, logs or
  any notification. The unique index decides, so two members verifying the same document at
  the same moment also resolve cleanly: one verifies, the other is declined, no error.
- **Duplicates flagged by Didit.** An `Approved` decision that carries `DUPLICATED_FACE`,
  `POSSIBLE_DUPLICATED_FACE`, `FRONT_CAMERA_DUPLICATED_FACE` or `DUPLICATED_DOCUMENT`
  anywhere in it is recorded as `declined`, never `verified`. This is a second line behind
  the workflow settings in step 2.
- **Polling fallback.** While a result is `pending` or `in_review`, opening the status
  (`GET /v1/me/age-verification`, which the Settings page does) fetches
  `/v3/session/{id}/decision/` and applies it by the same rules. Rate limited.
- **Calls.** `isAgeVerifiedAdult` (`apps/api/src/gists/eligibility.ts`) reads the table
  while the flag is on for the member, so a verified adult may host and join and the
  `CALLS_MEMBERS` list no longer counts for them. With the flag off for the member the
  `CALLS_MEMBERS` list works exactly as before.
- **Turning the flag off** stops new checks and the Settings entry. Results already on
  record stay, and the webhook keeps recording.

## Trying it on staging

1. Set the four settings, restart, sign in, open Settings: **Verify your age** shows.
2. Press it: you are sent to a `verify.didit.me` page. Complete a sandbox scenario.
3. Back on `/settings/age-verification` the state moves to **Verified** (webhook) or after
   a refresh (polling). Declined and expired scenarios show **Not verified, try again**.
4. In the Didit console, Deliveries shows each webhook attempt and the HeyNaija status
   code: `401` is a secret or clock problem, `404` means the settings are missing.
