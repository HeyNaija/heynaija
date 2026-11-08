# ADR 0022 — The Android and iOS apps sign in with Kratos session tokens

**Date:** 7 November 2026 · **Status:** Accepted · **Amends:** [ADR 0012](0012-auth-service-boundary.md) ·
**Related:** the apps' repository, `HeyNaija/heynaija-mobile` (its `docs/plan.md`)

## Decision

The Android and iOS apps sign up and sign in through Kratos's **native API flows**
(`/kratos/self-service/registration/api` and `/kratos/self-service/login/api`),
with the same emailed code as the web. A finished flow returns a **session
token** where a browser gets the `hn_session` cookie. The apps keep it in the
platform's secure storage and send it to the API as `Authorization: Bearer
<token>`.

- **The API** (`KratosSessionProvider`) reads the token from that header and asks
  Kratos's whoami with `X-Session-Token`. A token wins over a cookie: only the apps
  send one. Anything in the header that is not a plausible bearer token is ignored.
  Whoami answers for tokens are cached like cookies, in their own keys.
- **Signup** has no cookies to carry the invite code (`hn_invite`) and date of birth
  (`hn_age`). The apps send them in the flow's `transient_payload`, as
  `invite_code` and `birth_date`; `infra/kratos/invite-check.jsonnet` reads a
  cookie first and the payload second. The registration webhooks decide exactly
  as before, so the invite and age rules still live in the API.
- **Signing out** is Kratos's `DELETE /self-service/logout/api` with the token,
  after `POST /v1/logout` with the same header drops the cached lookup.

## Why

Kratos built the native flows for this. The alternatives were worse: a web view
for sign-in would hand the app a cookie it then has to lift out of the web view's
store, and proxying the flows through our API (ADR 0012's "fuller provider layer")
is still not needed. Nothing about the web changes.

CSRF does not apply to the token: a browser never sends it on its own, and a
cross-site page cannot set an `Authorization` header without a CORS preflight the
API does not allow. The session guard's Origin check is unchanged; the apps send
no Origin.

## Not yet

- **Google and Apple in the apps.** Both apps sign in with Google, and the iOS app
  with Apple, through the platforms' own sign-in: an ID token sent with its nonce
  ([ADR 0026](0026-ios-app-push-and-sign-in-with-apple.md)).
- **Push to the apps.** Android through FCM ([ADR 0023](0023-app-push.md)), iOS
  through APNs ([ADR 0026](0026-ios-app-push-and-sign-in-with-apple.md)).
