# Sign-in: emailed codes and Google

Members never have a password ([ADR 0003](../adr/0003-passwordless-sign-in.md)).
They sign up and sign in with a one-time code that Kratos emails them, or with
Google. Signing up still needs an invite, whichever way they choose.

Emailed codes work as soon as email does. Google is **off** until you create an
OAuth client and switch it on, as below.

## How it fits together

- `/login` shows **Continue with Google** above the email field. Kratos sends the
  code through Resend (Mailpit locally).
- `/join` checks the invite and sets the `hn_invite` cookie. `/signup` then asks
  for email and handle and emails a code, or, below that, offers Google. Google
  does not provide a handle, so after Google, `/signup` says the member is
  signed in with Google as their address and asks for the handle alone, with
  one "Finish creating my account" button; it does not show the signup form
  again.
- Either way, Kratos calls the API's registration webhooks, which check and then
  spend the invite. Without one, signup is refused.
- When an email-only member first chooses Google, Kratos verifies the Google
  email and finds the existing account before starting registration. The member
  confirms an email code within the same login flow. Kratos then links the
  original Google credential and signs them in automatically: no second Google
  authorization, Settings visit or additional invite.
- Later Google sign-ins go directly to that same account. The current Google
  email must still match the HeyNaija email.
- **Settings → Connected accounts** also connects or disconnects Google. A new
  connection requires a Google-verified email matching the signed-in account.
  Different emails are refused before saving the connection. Matching ignores
  case, but does not treat dots, plus-addresses or aliases as the same email.
- A member must disconnect Google before changing their HeyNaija email address.
  Settings disables the email field while Google is connected, with an explanation;
  handle changes remain available. Disconnecting Google unlocks email editing.
- For email-only accounts, saving a new email sends a confirmation code to that
  address. The original email remains the login address until the code is accepted.
  The member can resend or cancel in Settings; incorrect, expired or abandoned
  challenges leave the original email active. A sign-in older than 15 minutes
  requires reauthentication first. Successful confirmation updates the same
  identity and marks the new address verified.
- New Google members still need an invite and the age confirmation. If Google
  does not supply the required public handle, the signup form asks for it.

These rules are enforced by the version-pinned authentication image described
in [the Google account policy](../../infra/kratos/policy/README.md). An unmodified
upstream Kratos image does not enforce them. No database migration is required.

## Set up Google (once)

In the [Google Cloud console](https://console.cloud.google.com/), signed in with
the account that should own HeyNaija's Google setup:

1. Create a project, for example **HeyNaija**.
2. **Google Auth Platform → Branding:** app name **HeyNaija**, your support email,
   and under **Authorized domains** `heynaija.ng`. **Audience:** External.
   **Data access:** only `openid` and `.../auth/userinfo.email` (no sensitive
   scopes, so Google does not need to review the app).
3. **Audience → Publish app**, so it is "In production". Until then, only the test
   users listed there can sign in.
4. **Clients → Create client → Web application**, named after the environment
   (one client for staging, one for production, so either can be revoked alone).
   **Authorized redirect URIs:**

   | Environment | Redirect URI |
   | --- | --- |
   | Staging | `https://staging.heynaija.ng/kratos/self-service/methods/oidc/callback/google` |
   | Production | `https://heynaija.ng/kratos/self-service/methods/oidc/callback/google` |
   | Local | `http://127.0.0.1:3000/kratos/self-service/methods/oidc/callback/google` |

   Leave **Authorized JavaScript origins** empty. Google may refuse the local
   address; if it does, try Google on staging instead.
5. Copy the client ID and secret. The secret is shown once; keep it in the
   password manager.

## Switch it on

**Staging or production:** as `heynaija`, in `/srv/heynaija/infra/deploy/.env`:

```text
GOOGLE_SIGN_IN=true
GOOGLE_CLIENT_ID=<client ID>.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=<client secret>
```

Then deploy again: **Actions → Deploy staging → Re-run all jobs** on the latest
run, or on the server:

```bash
/srv/heynaija/infra/deploy/deploy.sh
```

**Locally:** the same three lines in the repository's `.env`, then:

```bash
pnpm infra:up --build
```

The build also picks up authentication policy changes after pulling new code.

To switch it off, set `GOOGLE_SIGN_IN=false` and deploy again. Members who joined
with Google can still sign in with a code sent to the same email.

## Existing accounts

Accounts created while HeyNaija used passwords cannot receive a sign-in code until
Kratos adds the email-code credential to them. Run this **once on each server**,
after the first deploy without passwords:

```bash
cd /srv/heynaija/infra/deploy && docker compose exec -e KRATOS_ADMIN_URL=http://kratos:4434 api node dist/cli/enable-code-login.js
```

It re-saves every account unchanged and prints how many it updated. Running it
again is harmless. Locally:

```bash
pnpm --filter @heynaija/api build && node apps/api/dist/cli/enable-code-login.js
```

Old password credentials stay in Kratos's database, but nothing can use them:
password sign-in is switched off.
