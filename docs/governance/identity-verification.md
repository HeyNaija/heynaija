# Identity verification with NINAuth: the planned design

**Status:** not built, switched off. HeyNaija collects no NIN data. This is the
design the code is shaped for, so the work package that builds it starts from
agreed constraints. Nothing here is a claim about what NINAuth provides: every
item marked *requires provider confirmation* must be confirmed by NIMC in the
partner agreement and in its production API, not from example payloads or the
public demo.

Sources: draft constitution v0.3 Article 4 and Annex A; NIMC's NINAuth
[getting started](https://ninauth.nimc.gov.ng/get-started),
[verification partners](https://ninauth.nimc.gov.ng/verification-partner) and
[developer guide](https://sso.ninauth.nimc.gov.ng/demo-sign-in/developer-guide).

NIN remains the initially preferred method, not a permanently exclusive legal
class. The constitution permits future legally acceptable equivalent identity
methods under a published reviewed policy; no alternative provider is built.
Legal membership is separate formal admission to the association. This design
only verifies identity; it neither admits legal members nor activates voting.
See [implementation.md](implementation.md) for the missing admission register.

## Principles

- Optional. Nothing on HeyNaija except voting membership needs it.
- HeyNaija never asks for, receives, logs or stores a NIN, a NIN slip, an ID photo,
  a date of birth or a legal name. The member consents on NINAuth, not on our site.
- The server decides everything. The browser only starts the flow and shows status.
- Keep the result, not the evidence: provider, status, dates and a keyed person
  key, plus an age band where the provider may share one, kept separately.

## Flow (OAuth 2.0 authorisation code with PKCE, back-channel exchange)

1. **Start** (`POST /v1/me/identity/verification`, not built): signed-in, active
   member; same-origin check (as `SessionGuard` already does); rate-limited. The
   member has read the consent text, whose version is recorded.
   The server creates a random `state`, a nonce and a PKCE verifier; stores
   `{ state, nonce, verifier hash, memberId, consentVersion, expires in 10 min }`
   server-side (Redis); and redirects to
   `NinVerificationProvider.authorizationUrl({ state, codeChallenge, redirectUri })`.
2. **Consent** on NINAuth: QR, share code or NINAuth sign-in.
3. **Callback** (`GET /internal/identity/callback`, not built): the redirect URI
   is registered exactly with NIMC. The server:
   - looks up `state` and deletes it in the same step (single use, so replays fail);
   - checks it belongs to the session that started it;
   - calls `exchange({ code, codeVerifier, redirectUri })` server-to-server;
   - verifies the token: signature against NIMC's published keys, issuer,
     audience (our client ID), expiry, nonce; rejects anything else;
   - maps the claims to `ProviderResult` and calls
     `GovernanceService.recordVerification`;
   - never logs the code, tokens, claims or the raw response; errors are logged
     as a short code only.
4. **Review:** a person on the team confirms the verification
   (`reviewVerification`) before any public badge.
5. **The member chooses** to show the tick (`setBadgeVisible`), and separately
   whether, once formally admitted as an eligible legal member, to activate online
   voting voluntarily. Online deactivation never itself ends legal membership or
   formal association meeting rights.

If NIMC offers signed webhooks (for revocation, say), verify the signature and a
timestamp, and keep a short-lived record of event IDs to reject replays.

## What HeyNaija would store (`restricted.identity_verifications`)

| Column | From | Notes |
|---|---|---|
| `provider` | us | `ninauth` |
| `status` | us | pending, verified, rejected, expired, revoked |
| `person_key` | HMAC(`IDENTITY_KEY_SECRET`, provider + subject) | *Requires provider confirmation* that a stable pseudonymous subject exists. Null otherwise, and then formal voting stays blocked for that member |
| `verified_at`, `expires_at` | provider | *Requires provider confirmation* of result lifetime |
| `consent_version`, `consented_at` | us | |
| `reviewed_at`, `reviewed_by` | us | |
| `revoked_at`, `outcome` | us | short codes only |

An over-18 result from the same check, if NINAuth may share one (*requires
provider confirmation*), is not stored on this row. It becomes its own row in
`restricted.age_assurances` (`method = identity_provider`, linked by
`verification_id`), because identity and age are separate questions (ADR 0006).
Revoking the verification withdraws it. A voting member needs a verified adult
age from some check, not only a stated one.

## Uniqueness

A partial unique index on `(provider, person_key) where status = 'verified'`
means one person holds one verified account at a time. A second account is stored
as `rejected / duplicate_person` and can be appealed (for example to move
verification to a new account: revoke the old one, then verify the new one).

## Still to decide

Result lifetime and renewal; how an appeal of `duplicate_person` is handled; who
may review; the retention period for each column after revocation or account
deletion; whether NINAuth's sign-in, QR or share-code flow is used for the web.
See [open-items.md](open-items.md), section 3.
