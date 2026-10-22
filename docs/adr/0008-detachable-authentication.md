# ADR 0008 — Detachable authentication through an application-owned AuthService

**Date:** 18 October 2026 · **Status:** Stages 1–4 implemented for review;
stage 5 migration schema and backfill tooling are implemented, while runtime
identity cutover and multi-provider interaction binding remain deferred ·
**Amends:** ADR 0002's direct Kratos coupling

## Context

HeyNaija needs to replace its authentication backend without rewriting social
features, and eventually allow more than one authentication backend at once.
Application code currently depends on Kratos in both the API and the web app.
An interface around one HTTP call would isolate session lookup, but would not
make signup, login, settings or logout portable.

This ADR defines boundaries and observable behaviour. Session authentication,
export email lookup and logout cache invalidation now use the boundary, without
changing authentication policy or database schema. Kratos remains the only
implemented authentication backend. Later stages
must address controller callbacks and identity mapping before claiming complete
detachability or simultaneous-provider support.

An **auth provider** here is a configured authentication backend, such as a
Kratos installation. Google and emailed codes are currently **login methods**
managed by that backend. Enabling two methods is different from running two
independent backends. Provider IDs identify configured instances, not just vendors.

## Baseline behaviour before extraction, verified from repository code

- `apps/api/src/auth/session.guard.ts` reads `hn_session` and calls
  `KratosService.identityForSession`. Success attaches an identity to the request;
  the guard also checks application membership and suspension. Failure normally
  throws an HTTP exception rather than returning `false`. A rejected request can
  still belong to a known but suspended or uninvited identity.
- `apps/api/src/auth/kratos.service.ts` calls `/sessions/whoami`, validates the
  response, and returns an identity or `null`. Valid identities are cached for
  `WHOAMI_CACHE_TTL_S` (30 seconds by default). Provider failures are errors,
  distinct from invalid credentials. Redis cache keys hash the credential.
- `OptionalSessionGuard` currently catches every `HttpException`, including
  provider-unavailable errors, and permits an anonymous public read. This is an
  existing public-read fallback, not evidence that the provider rejected a session.
- Sign-in is currently orchestrated by `apps/web/lib/kratos.ts` and the account
  pages. They start/fetch Kratos flows; `app/ui/flow-form.tsx` renders fields and
  submits to the provider through `/kratos`. NestJS does not currently complete
  sign-in. Registration and settings webhooks are application-policy callbacks,
  not a general login callback.
- Registration means signup. The registration hooks check eligibility and redeem
  an invite; an external account alone does not grant HeyNaija membership.
- `/verification` exists in `apps/web/app/(auth)/verification/page.tsx` and loads
  a Kratos verification flow. Ordinary signup already proves email control through
  an emailed code or Google, so it does not require a separate verification step.
  Email verification is unrelated to NIN verification or age assurance.
- `forgetSession` only evicts a cached lookup. The web logout route first requests
  that eviction, then redirects to Kratos's token-bearing logout URL. Kratos ends
  the session and clears its cookie. Cache eviction is best effort; failures can
  leave a cached identity usable until its TTL expires.
- Kratos handles login email, handle and Google connections through settings.
  Display name, bio and avatar are application profile data. Data export asks
  Kratos for the current member's email separately from cached identity lookup.
- `/sessions/whoami` proves a session is valid; it does not itself require a fresh
  sign-in. Kratos settings enforce `privileged_session_max_age: 15m`; the login
  page handles a refresh flow when the member must authenticate again.
- `infra/kratos/policy/` contains Go additions compiled into Kratos, including
  confirmed email changes and Google linking restrictions. These are behavioural
  requirements to preserve, not functionality supplied by a TypeScript interface.

## Decision

### One application entry point, focused provider contracts

Introduce a TypeScript `AuthService` as the backend application entry point.
Guards and application services depend on it, not on `KratosService`, cookie
names, provider URLs or provider response types. NestJS injection tokens select
the configured implementations; TypeScript interfaces alone have no runtime value.

Use three focused contracts beneath that service. One `KratosAuthProvider` may
implement all three; separate contracts do not require separate processes or
classes. Caching stays a separate injected dependency, as it is today.

| Contract | Operations | Expected result |
|---|---|---|
| `AuthSessionProvider` | Authenticate request credentials; invalidate cached session lookup | Authenticated provider identity or anonymous; invalidation never claims to revoke a session |
| `AuthFlowProvider` | Begin, resume and submit login, registration, email verification, reauthentication and logout interactions | A next interaction, a validated redirect, completion or a defined error |
| `AuthAccountProvider` | Read the authenticated account's private email and connection information; begin supported account changes | Authorised account information or an interaction handled through the same flow mechanism |

These operation names and result semantics define the contract. Exact transport
DTOs for form fields, cookies and callbacks will be specified when implementing
the flow adapter, rather than prematurely copying Kratos's node schema.
Account changes may require several steps; they are not assumed to be one-shot
`updateEmail` calls. Logout may also require a browser redirect before completion.

The session boundary has this shape (provider details use a discriminated union
as additional provider kinds are introduced):

```ts
type AuthRequest = {
  cookieHeader?: string
  authorizationHeader?: string
}

type ProviderIdentity = {
  providerId: string
  subject: string
} & (
  | { providerKind: 'kratos'; details: KratosIdentity }
)

type AuthenticationResult =
  | { status: 'anonymous' }
  | { status: 'authenticated'; identity: ProviderIdentity }

interface AuthSessionProvider {
  hasCredentials(request: AuthRequest): boolean
  authenticate(request: AuthRequest): Promise<AuthenticationResult>
  invalidateSessionCache(request: AuthRequest): Promise<void>
}
```

The request is a minimal server-side credential envelope, not a Fastify request
and not a browser DTO. Adapters extract and forward only their own credentials;
raw headers, credentials and provider tokens must not enter application logs or
public identity results. Provider subjects are opaque strings, not assumed UUIDs.
An adapter may keep internal session metadata without exposing it as member data.

`AuthService` owns provider selection and error normalisation. Adapters own
provider HTTP calls, response validation, cookie conventions and protocol details.
The existing guard's membership checks remain application logic. A provider
identity must be resolved to an application member before social services receive
`req.member`; it must not be substituted directly for a member ID.

### Expected behaviour

| Situation | Contract |
|---|---|
| No credentials, expired/revoked session or inactive provider identity | Anonymous result; protected routes return 401 |
| Provider timeout, unexpected response or malformed payload | Distinct unavailable/protocol error; protected routes do not turn it into anonymous or successful authentication |
| Public read during a provider failure | May deliberately render anonymously under the existing optional-read policy; the auth service preserves the error distinction and writes never use this fallback |
| Valid external identity without application membership | Denied application access; authentication alone never spends an invite or grants membership |
| Suspended member | Denied normal protected actions; designated appeal/export routes retain their existing exceptions |
| Cached identity | Bounded configured TTL; suspension remains checked on every request; provider revocation may lag by the TTL |
| Cache unavailable | Fall back to provider validation; cache eviction failure must not be described as confirmed session revocation |
| Sign-in completion | Report success only after provider evidence is validated; a redirect query or client claim is insufficient |
| Logout | Target the selected current session, evict its cache and complete provider logout/cookie handling; failure or pending redirect is not completed logout; global logout is a separate future capability |
| Sensitive account change | Enforce provider-backed fresh authentication for the operation; ordinary cached session lookup is insufficient |
| Unsupported operation | Explicit unsupported-capability error; never silently succeed |

Normalised errors distinguish unavailable, protocol failure, invalid/expired
interaction, validation failure, reauthentication required, unsupported operation
and conflicting credentials. Provider-specific diagnostic data stays private.
Validation messages exposed to the member must not leak credentials or secrets.

The current authentication policy remains: emailed codes and Google, passwords
and password recovery disabled. Preserve the existing confirmed-email-change and
Google-linking policies described in `infra/kratos/policy/README.md`, including
proof before linking, verified matching Google email, and confirmation of a new
email before replacing the login address. A replacement must demonstrate these
behaviours or obtain an explicit policy amendment; capabilities cannot silently
downgrade them.

### Frontend boundary and interaction ownership

The final design also needs an application-owned frontend auth facade. Pages
request login/signup/settings/logout operations without importing Kratos types
or constructing Kratos URLs. This facade calls the server-side auth integration;
it does not validate credentials itself or put provider secrets in the browser.

Interactions can return a redirect, a form/challenge, or completion. The adapter
translates provider data; the application preserves its visual components.
Initially isolate the existing `FlowForm` as Kratos-specific code. Extract shared
rendering only after another interaction needs it. A universal form engine is
not a prerequisite for the backend session abstraction.

Preserve provider CSRF protection, cookies, OAuth state/PKCE where applicable,
one-time logout tokens and recent-authentication requirements. Interaction state
must bind the provider and initiating browser/session, survive required redirects,
expire, and reject replay where the protocol requires it. Browser-supplied
provider IDs or return URLs alone are not proof of that binding. Only configured,
validated submission and redirect targets are accepted. Preserve first-party
application cookies while allowing the necessary external identity-provider redirects.
Do not introduce a second application session system as part of this ADR.

The backend-first work does not immediately move all browser flows into NestJS.
Until the frontend integration is migrated, those flows continue through Kratos
and the application is only partially decoupled.

### Configuration and multiple providers

One composition point selects enabled provider IDs and a default for new login
attempts. A new provider requires an adapter, credentials/configuration and
contract validation; selection can then be a configuration change. It does not
automatically migrate existing accounts or sessions.

An interaction stays with its chosen provider through completion. Route session
credentials deterministically; do not try other providers on timeout or rejection.
Ambiguous credentials must be rejected rather than silently choosing a different
member. Cache keys include provider instance identity as well as a credential hash.

Simultaneous providers require a stable application member ID mapped from
`(providerId, subject)`. The current Kratos-ID-as-member-ID and handle ownership
remain in place during the first implementation slice. Mapping, handle uniqueness,
existing-account migration and explicit linking/unlinking rules need a later
design before enabling a second backend. Never merge members merely because
emails match. Registration policy callbacks must also work for every enabled
provider before new signup paths can be enabled.

Providers declare supported operations. Startup rejects unknown providers and
configurations missing required product capabilities. Frontend capability display
does not replace server enforcement. A second backend is not enabled just because
it can implement `authenticate`.

## Relationship to earlier ADRs

| ADR | Effect of this proposal |
|---|---|
| [0001](0001-phase-0-spike.md) | Remains superseded. This does not restore AT Protocol, federation or the former OAuth implementation. |
| [0002](0002-conventional-stack-with-kratos.md) | Amends the direct dependency on Kratos with an application-owned boundary; Kratos remains the first implementation. Conventional architecture, delegated authentication and one-origin application routing remain. Its original no-session-cache description is historical: current code has a bounded cache. Member-ID migration is deferred, not silently implemented by this decision. |
| [0003](0003-passwordless-sign-in.md) | Passwordless product policy stands. Kratos-specific configuration becomes adapter detail; replacing it must preserve methods and handle uniqueness. |
| [0004](0004-handles-held-after-rename.md) | Current-handle uniqueness and the 30-day hold remain requirements. Moving the webhook or handle authority is later work; the hold must apply across providers. |
| [0005](0005-governance-and-identity-groundwork.md) | Invite/age admission checks remain server-enforced. Auth providers are distinct from NIN verification providers; verification and voting switches stay disabled. |
| [0006](0006-age-status-model.md) | Age assurance remains separate from login and email verification. A provider identity supplies no automatic age or voting eligibility. |
| [0007](0007-reposts-and-quotes.md) | No change to social behaviour or data-export format. |

Older ADRs remain historical records. This ADR does not treat their old test
counts, deployment statements or limitations as current evidence.

## Implementation sequence and acceptance evidence

1. Review these contracts and expected behaviour (this document only).
2. Introduce `AuthService`, an injection token and the Kratos session adapter.
   Route the guard through the boundary while retaining existing member IDs and
   membership enforcement. Keep frontend flows unchanged. Explicitly check that
   extracting identity lookup does not change public-read fallback or suspension.
3. Migrate remaining backend consumers, including export and logout-cache
   handling. Separate application policies from Kratos webhook transport when
   revisiting the auth controller. Isolate frontend Kratos flow imports.
4. Implement the flow/account contracts and frontend facade, preserving actual
   browser login, signup, verification, settings, reauthentication and logout.
5. Design identity mapping/migration and cross-provider policy enforcement, then
   implement a second provider to prove detachability and simultaneous use.

Reusable contract checks must cover valid/invalid credentials, provider failures,
malformed responses, cache expiry/failure/invalidation, suspension, unsupported
operations and deterministic provider routing. Integration checks must preserve
invite/age rejection, handle rules, account linking, confirmed email changes,
expired/foreign interactions, fresh-authentication enforcement and actual logout
(not just cache eviction). Multi-provider checks must demonstrate separate subjects
cannot collide or become the same member without authorised linking.

Use the existing API tests and browser journeys as regression evidence. Adapter
stubs prove contracts, not live provider interoperability. Real Google/provider
journeys need their own evidence; the session implementation tests do not exercise
live browser authentication.

## Consequences

Social code gains a stable authentication entry point, while provider-specific
behaviour has an explicit home. There is additional adapter and interaction code
to maintain. Full detachability spans frontend, backend, operational configuration
and identity lifecycle; a one-line selector is the eventual configuration surface,
not a claim that changing identity systems is migration-free.

## First session implementation (18 October 2026)

- `auth/auth-session.provider.ts` defines credentials, provider results, errors
  and the injection token. `auth/kratos-session.provider.ts` extracts only the
  Kratos cookie and delegates validation/cache eviction to the existing service.
- `auth/auth.service.ts` is the guard's entry point. `app.module.ts` binds the
  `AUTH_SESSION_PROVIDERS` token through `useFactory` to a registry keyed by
  configured provider ID. The only registered instance is `kratos`.
- Compatibility bridge: the adapter returns Kratos identity under `details`, with
  `providerId`, `subject` and the `providerKind` discriminator at the top level, and `AuthService` maps that subject to the existing member ID.
  This is deliberately limited to the current Kratos installation. Persistent
  identity mapping must replace it before another provider can be enabled.
- The guard retains membership creation, invite checks, suspension and origin
  checks. Its optional variant still permits anonymous public reads on provider
  HTTP errors. Malformed provider responses now become a defined protocol error
  (503 for protected requests), rather than leaking a JSON/schema exception.
- This first slice left export and auth-controller cache eviction on their old
  paths; stage 2 below migrates them. Browser flows, schema and Go policy remain
  unchanged.
- Tests exercise the guard through the service/adapter with provider HTTP
  stubbed, plus request credential isolation, errors and cache invalidation.
  This does not demonstrate live Kratos or Google interoperability.

### Session routing

`AuthService` uses each registered adapter's `hasCredentials` predicate. This
is local credential recognition, not validation or a request to the provider.
Kratos recognises the presence of `hn_session`; its authentication method still
rejects empty/duplicate cookies and asks Kratos to validate the selected value.
No matches means anonymous. Multiple matches return a credential-conflict 401
on protected requests, before any provider is called. Optional public reads keep
the existing anonymous fallback. Cache invalidation uses the same selection rule.

There is no client-supplied provider selector and no fallback to another provider
after rejection or an outage. A returned identity's `providerId` must match the
selected registry key. The temporary member bridge accepts only the existing
`kratos` instance and checks subject/detail ID consistency; new instances cannot
reuse that bridge and accidentally collide with existing members. Registry
extensibility does not complete persistent identity mapping or browser-flow
routing. Future providers need disjoint credential recognition (or a separately
validated routing mechanism), mapping and cache namespaces before activation.

## Stage 2: export and cache invalidation

- `ExportController` asks `AuthService.emailForRequest` for the current session's
  private email. The initial `AuthAccountProvider` contract contains this read
  only; account changes and connections remain future work. Kratos's adapter
  implements both session and account contracts. The registry permits account
  reads as an explicit optional capability; a selected adapter without the
  capability returns an unsupported-operation error, not a fabricated null email.
- Email lookup uses the same credential routing as authentication, but reads
  directly from the provider without the identity cache. Missing/ended sessions
  still yield null. Provider/protocol failures remain errors. Export retains
  its guard permitting suspended members, rate limit, member-ID scoping, format,
  no-store header and missing-member 404.
- `AuthController.logout` forwards credentials to
  `AuthService.invalidateSessionCache`; it no longer knows a provider cookie
  name or depends on `KratosService`. The endpoint remains unguarded and returns
  204 on success. No matching credentials is a no-op; conflicting credentials
  are rejected before any provider call. This still only evicts the selected
  session's cache entry. The existing browser redirect performs actual logout.
- Both handlers forward a server-side credential envelope, not a browser-selected
  provider ID. Known provider errors are normalised by `AuthService`; unrelated
  errors are propagated. Registration/settings webhooks are unchanged.
- Regression coverage includes fresh email after cached authentication, null email,
  provider failures, unsupported account reads, credential conflicts, cache
  eviction through the logout handler and the existing database-backed auth/export
  checks. Provider HTTP is stubbed; this is not a live browser-provider test.

## Stage 3: frontend isolation

- `apps/web/lib/auth/server.ts` is the server-only facade and the single frontend
  provider selection point. `types.ts` defines the page-facing contract: render
  an auth form, start an interaction, read a logout URL or error, validate a logout
  target, and forward/check session credentials. Pages receive a rendered form,
  not raw Kratos nodes. This is a frontend integration contract, not the future
  backend flow protocol.
- `providers/kratos/` owns HTTP flow/session helpers, the existing form renderer,
  message translations, Google grouping, reauthentication, settings email-change
  handling and removal of stale flow parameters. Rendering and form actions are
  preserved; no universal form engine is introduced. Only the flow-parameter
  cleanup component is client-side; provider HTTP helpers stay server-only.
- Login, signup, verification, settings, error pages, account-menu logout and
  invite acceptance use the facade. The general API helper obtains its session
  headers through it; the Kratos cookie name stays inside the integration. Raw
  cookies still reach Kratos's flow endpoints unchanged for CSRF, while only the
  session cookie reaches the application API.
- Logout retains the existing local-target validation, cache-eviction call and
  provider redirect. Invite and age admission checks remain in the application.
  `/kratos` proxy configuration and browser submission to Kratos remain in place.
- Frontend selection remains Kratos-only and must agree with the API registry.
  Multi-provider interaction binding, a normalised challenge protocol and moving
  browser flow operations into the backend are later stages; this extraction
  does not claim those are implemented.
- `e2e/auth-facade.config.ts` supplies separate browser integration checks against
  fixture HTTP responses. See `docs/e2e.md` for scope and execution. Those checks
  do not replace real Kratos/Google end-to-end evidence.


## Stage 4: flow/account contracts and account journeys

`AuthFlowProvider` now defines begin, resume, submit, explicit reauthentication,
logout-link creation, logout completion and flow-error lookup. `AuthAccountProvider`
has explicit capability flags plus private-email lookup and account-change entry.
Email/handle/connected-account changes start a settings interaction and complete
through the common flow submission contract. The existing private-email read
remains uncached. This does not add password recovery, account deletion or other
methods beyond the existing product.

`AuthLifecycleProvider` translates provider callback payloads into normalized
registration and settings events. `AuthController` still owns application policy
decisions (invite redemption, age admission and held handles), but no longer
parses Kratos's identity/trait payload shape. The Kratos adapter owns that
translation, and the callback transport remains authenticated by its webhook
secret. The existing `/internal/kratos/*` deployment hooks remain compatible.

`AuthService` selects the configured flow implementation and normalises provider
errors. `AUTH_DEFAULT_PROVIDER` supplies the provider for visitors without session
credentials. There is only one enabled flow provider; multiple flow backends are
explicitly refused until provider-bound interaction storage and member identity
mapping are implemented. Kratos still validates each flow's browser cookies,
CSRF token, expiry and reauthentication state. A submitted flow ID is never treated
as authentication proof by HeyNaija.

The frontend helpers now call these API routes:

| Operation | Route |
|---|---|
| Start login/signup/verification/settings | `GET /v1/auth/flows/:kind/start` |
| Resume an interaction | `GET /v1/auth/flows/:kind?flow=...` |
| Submit its form | `POST /v1/auth/flows/:kind?flow=...` |
| Require fresh login | `GET /v1/auth/reauthenticate` |
| Obtain logout link / complete logout | `GET /v1/auth/logout/link`, `GET /v1/auth/logout?token=...` |
| Current private email / flow error | `GET /v1/auth/account/email`, `GET /v1/auth/errors?id=...` |

The browser reaches these through `/api`; server rendering calls the internal API.
Resumed interactions have a form/redirect envelope and a provider-kind discriminator.
The existing Kratos renderer consumes its form payload. A universal field schema
is still unnecessary: provider-specific data remains in the selected renderer.

The API forwards raw cookie/form bytes, including invite and CSRF cookies, to the
configured provider only. Nest's form parser preserves repeated fields and limits
encoded form bodies to 64 KiB. Foreign-origin writes are rejected; provider CSRF
validation remains mandatory. URLs are constructed from fixed endpoints and encoded
identifiers, not browser-supplied upstream addresses. Form action origin, path and
flow ID are validated and rewritten to the application submission route. Every
browser transition preserves separate Set-Cookie headers and returns a no-store
redirect. Expired interactions restart; validation messages reload the same flow.
Unexpected provider failures never count as successful authentication.

`AUTH_EXTERNAL_REDIRECT_ORIGINS` is an exact-origin allowlist, defaulting to
`https://accounts.google.com`. HTTP is restricted to explicitly configured loopback
test issuers. Local application redirects are allowed; other external destinations
are refused. See `docs/e2e.md` for the local Google test issuer configuration.
Google OAuth callbacks still use `/kratos` and Kratos's own token verification and
Go account policies. Settings may redirect into Kratos's own refresh-login entry
point; the returned flow is resumed and submitted through the application API.
The proxy must therefore remain deployed.

Logout completion now performs best-effort cache eviction in the backend and then
calls the provider's token-protected logout endpoint, relaying its cookie clearing.
The Next.js logout route only validates and redirects to the application logout
URL. The previous `/v1/logout` cache-only endpoint stays for compatibility and is
not evidence of completed logout. The API does not claim success if provider
termination fails. Cache failure can retain an identity until its bounded TTL,
as before.

Deploy the API before (or together with) the frontend: new pages require these
routes. Existing provider proxy routes, signup/settings webhook paths, member IDs,
Go policies and database schema remain in place. A second backend requires the
next stage's mapping and callback-policy work; selecting a new class alone is
not a complete migration.

Validation includes lifecycle, controller/adapter tests using actual Nest/Fastify routing,
form parsing and HTTP responses; existing auth/export/database regressions;
web type checks/build; and browser journeys through the real controller/service/
adapter against fixture Kratos HTTP responses. This proves application wiring,
not live Kratos code delivery, Google OAuth or deployed account-policy behaviour.
Those live-provider journeys must still be rerun before deployment.

## Stage 5 migration release procedure

Stage 5 uses an expand–backfill–cutover release. Generated Drizzle schema
migrations are committed and reviewed before deployment. The deployment's
existing `migrate` service applies them before the API starts; production does
not generate schema SQL at runtime.

The additive schema introduces `provider_identities`, which maps an opaque
`(provider_id, subject)` pair to the existing application member ID. Existing
Kratos member IDs are not rewritten. `identity_migration_runs` and
`identity_migration_rows` record the backup reference and every mapping inserted
by a backfill run.

After deployment, an operator may preview, backfill or verify with
`identity:backfill`. The command uses a PostgreSQL advisory lock, refuses remote
targets unless explicitly allowed, requires a backup reference and confirmation
for writes, checks duplicate handles before the unique index migration, and
performs the backfill in one transaction. A run may be rolled back only before
the application cutover marker is set. After cutover, mapping deletion is
refused: restore or forward-fix is safer than making authenticated accounts
disappear.

Request authentication and lifecycle callbacks now resolve identities through
the mapping while retaining the legacy Kratos-subject fallback during the
compatibility period. The backfill must be verified before application cutover
is marked. Marking cutover means the application is ready to remove that legacy
fallback; invite redemption, age records, moderation, export and governance must
use the stable member ID before it is removed.
