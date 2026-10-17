# HeyNaija account policies

The `infra/kratos/Dockerfile` builds upstream Kratos **v26.2.0** from its
checksum-pinned source archive and applies `google-account-linking.patch` and
`email-confirmation.patch`.
The runtime remains the upstream Kratos image. The upstream OAuth exchange,
JWT verification, state/CSRF checks, email codes, identity storage and sessions
are retained. No Google token is accepted or verified by the frontend.

This patch adds policy that the upstream open-source image does not enforce:

- A first Google login whose verified email matches an existing code-login
  identity keeps the Google credential in Kratos's private login-flow context.
  The existing account confirms an email code in that same flow. Kratos's native
  duplicate-identifier check and the additional verified-email binding run
  before linking. The original Google authorization is reused; no Settings visit,
  second Google authorization, new identity or invite is needed.
- Google must provide a verified email. Matching ignores case and surrounding
  whitespace only. Dots, plus-addresses and aliases are not collapsed.
- Settings rejects a Google connection whose verified email differs from the
  signed-in identity's email, before credentials or authentication methods are saved.
- Every subsequent Google login checks the current Google email against the
  account email too. A previously mismatched connection does not grant a session.
- An account with Google connected must disconnect it before changing its email.
- Email-only accounts confirm a code sent to the new address before their login
  email changes. The proposed address, expiry and server-secret HMAC stay in the
  private Settings flow; the identity and login identifier remain unchanged until
  confirmation. Nothing reserves the unconfirmed email on an identity.
- The code is bound to the identity, Settings flow, original email, new email and
  a fresh nonce. Attempts and consumption are serialized with PostgreSQL row
  locks. The code lifetime and attempt limit follow the native code configuration;
  sends are throttled to one per minute across the identity's current flows.
  Resending replaces the code. Cancelling or abandoning keeps the original email.
  Confirmation uses the existing CSRF checks, recent sign-in requirement, native
  code generator, secret HMAC primitive, mail queue and settings persistence hooks.
- An occupied public handle cannot trigger a cross-email account-linking prompt.
- New Google accounts still use the ordinary invite, age and registration hooks.
  The identity schema and database migrations are unchanged.

`heynaija*.go` is copied into the upstream `oidc` package. `profile_email*.go`
is copied into the upstream `profile` package, and `persistence_email.go` into
`persistence/sql`. This policy targets the PostgreSQL deployment used here.
The image build runs their Go
policy tests and fails if the pinned patch no longer applies exactly.

Build and test with:

```sh
docker build -t heynaija-kratos:dev infra/kratos
pnpm e2e google-auth --workers=1
pnpm e2e email-change --workers=1
```

The browser tests use a temporary local OIDC issuer that signs real test JWTs.
They exercise the actual callback, email challenge and persistence. The test
fixture serializes access across projects and restores the normal local Google
configuration in teardown. Google Cloud client configuration and live Google
consent remain outside these automated tests.

Deployments must use the `-kratos` image built alongside the API and web images;
using `oryd/kratos` directly omits these policies. `kratos-migrate` continues to
use the unmodified upstream image at the same version. For an upstream upgrade,
review and update the archive checksum, patch, policy tests and runtime version
as one change. Do not substitute the upstream automatic-linking option: this
implementation deliberately confirms existing-account ownership by email.
