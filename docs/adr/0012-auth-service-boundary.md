# ADR 0012 — Session lookup goes through an AuthService

**Date:** 23 October 2026 · **Status:** Accepted · **Amends:** ADR 0002

## Decision

The API asks who is signed in through one `AuthService`
(`apps/api/src/auth/auth.service.ts`), never through Kratos directly. The session
guards, the data export (for the member's email) and `/v1/logout` (to drop the
cached lookup) use it. Behind it sits one `AuthSessionProvider`, implemented for
Kratos by `KratosSessionProvider`; Kratos is the only provider.

The web app does the same: pages and `lib/api.ts` import from `lib/auth/server.ts`,
and everything that knows about Kratos (its flows, form renderer, session cookie
and logout URL) lives in `lib/auth/providers/kratos/`. The browser still talks to
Kratos through the `/kratos` rewrite, as before.

## Why

Before this, the guard, the export and logout each read the `hn_session` cookie
and called `KratosService` themselves, and the web app's pages imported Kratos
helpers directly. Putting that behind one service keeps cookie names and Kratos
responses in one place, gives the tests one thing to stub, and makes two failure
cases explicit:

- **Kratos down or answering nonsense is a 503, not "signed out".** Kratos
  failures raise `AuthProviderError`, which `AuthService` turns into a 503 with
  `code: auth_provider_unavailable` or `auth_provider_protocol`. A malformed
  whoami answer used to surface as a 500. Public reads behind
  `OptionalSessionGuard` still fall back to the signed-out view, as before.
- **A cache failure is a miss.** If the session cache throws, the lookup goes to
  Kratos; a failed write never undoes an answer Kratos gave.

## What this is not

It is not a way to swap Kratos out. Sign-up, sign-in, Settings and Google
connections are still Kratos flows rendered by Kratos-specific code; the invite,
age and handle rules are still Kratos webhooks; and `members.id` is still the
Kratos identity ID. A fuller provider layer (proxying flows through the API, an
application-owned table mapping provider subjects to members, more than one
provider at once) was considered and left out: none of it is needed while Kratos
is the only provider, and none of it gets cheaper by being built early. Members
sign in with an emailed code or Google, so there are no password hashes to move
if that day comes, and the subject-to-member mapping can be backfilled then.

## Consequences

- Duplicate `hn_session` cookies in one request are treated as signed out instead
  of one being picked; the cookie is passed to Kratos exactly as sent.
- Kratos failures now log a warning from `AuthService` and return a JSON body
  with a `code` the web app can tell apart from a 401.
