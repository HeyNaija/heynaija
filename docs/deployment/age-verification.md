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
set on approval), `verified_at`, and `didit_session_id`. Never the document, the face, a
date of birth, a name, Didit's payload or its hosted URL. The row goes when the account
does (`ON DELETE CASCADE`).

## Setup steps

1. **Didit console** (business.didit.me): create an application. Start with the sandbox
   one; its sessions can be armed with scenarios (`sandbox_scenario`) so approved and
   declined can be tried without a real ID.
2. **Workflow**: create a KYC workflow that decides whether the person is 18 or over, for
   example ID verification with a minimum-age rule, or age estimation (the ADR prices both).
   HeyNaija treats Didit's `Approved` as "an adult", so the 18+ rule must live in the
   workflow: a workflow that approves every real ID would verify minors. Copy the workflow
   id.
3. **API key**: create one with the `read:sessions` privilege (needed for the decision
   fetch) and permission to create sessions.
4. **Webhook destination** (API and Webhooks): URL `https://<site>/api/v1/webhooks/didit`
   (the web app proxies `/api/v1` to the API, so no nginx change), subscribed to
   `status.updated` only. Copy the destination's **secret** (`secret_shared_key`). If the
   site is behind Cloudflare with rules that block unknown senders, allow Didit's address
   (18.203.201.92 at the time of writing).
5. **Environment** (`infra/deploy/.env`, local `.env`): `DIDIT_API_KEY`,
   `DIDIT_WORKFLOW_ID`, `DIDIT_WEBHOOK_SECRET`. Restart the API.
6. **Flag**: `ageVerification` is on in development and staging and off in production. In
   production an admin turns it on from Moderation, Feature flags, first as an allow-list
   of a few named members ([feature-flags.md](../feature-flags.md)).

Callback address (sent with each session): `<WEB_PUBLIC_URL>/settings/age-verification`.
That page reads the result from the API; the `status` Didit appends to the address is not
used.

## Behaviour to know

- **Fails closed.** With any of the three settings missing, no check is offered
  (`GET /v1/me/age-verification` says `available: false`), `POST .../session` answers 503,
  and the webhook answers 404. The API still starts. A missing webhook secret never means
  "accept anything".
- **Webhook checks.** `X-Signature-V2` only: HMAC-SHA256 (hex) of the parsed body with
  sorted keys, compact separators and Unicode kept, compared in constant time, accepted
  also from `X-Signature-V2-Previous` for the 24 hours after a secret rotation. `X-Timestamp`
  must be within 300 seconds of now (replays are refused). `X-Signature-Simple` is never
  accepted, because it does not cover the decision. The docs list `X-Signature` (raw
  bytes) as an alternative; it is not used.
- **Whose result.** The session id must be the one stored for the member named in
  `vendor_data` (the member id). Any other session, an old one, or a delivery for nobody
  is accepted and ignored.
- **Order.** Deliveries repeat and may arrive out of order, so a result never moves back
  (a late `In Review` cannot undo an approval). Two moves are deliberate: a reviewer in
  Didit's console can approve a declined or expired session, and can reverse an approval.
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

1. Set the three settings, restart, sign in, open Settings: **Verify your age** shows.
2. Press it: you are sent to a `verify.didit.me` page. Complete a sandbox scenario.
3. Back on `/settings/age-verification` the state moves to **Verified** (webhook) or after
   a refresh (polling). Declined and expired scenarios show **Not verified, try again**.
4. In the Didit console, Deliveries shows each webhook attempt and the HeyNaija status
   code: `401` is a secret or clock problem, `404` means the settings are missing.
