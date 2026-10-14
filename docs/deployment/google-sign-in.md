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
  for email and handle and emails a code, or offers Google. After Google, Kratos
  asks for the handle, since Google does not provide one.
- Either way, Kratos calls the API's registration webhooks, which check and then
  spend the invite. Without one, signup is refused.
- Someone without an account who picks Google on `/login` is sent to signup, and
  from there to `/join` if they have no invite.
- **Settings → Connected accounts** connects or disconnects Google for a member
  who joined by email.
- Google's address counts as verified only if Google has verified it
  (`infra/kratos/google.jsonnet`). If a Google account's email already belongs to
  a member, Kratos asks them to sign in with a code first, then links the two.

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
pnpm infra:up
```

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
