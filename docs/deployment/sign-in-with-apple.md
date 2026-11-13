# The iOS app: Apple's key, push and Sign in with Apple

The iOS app signs in with Apple and gets push notifications through Apple's push
service ([ADR 0026](../adr/0026-ios-app-push-and-sign-in-with-apple.md)). The
server needs one Apple key for both. Sign in with Apple works without the key;
push and revoking Apple's tokens when an account is erased need it.

All of it is done once, in [Apple's developer site](https://developer.apple.com/account),
signed in to HeyNaija's Apple developer account.

## 1. The app's ID

**Certificates, Identifiers & Profiles → Identifiers** → `ng.heynaija.app` (Xcode
makes it on the first signed build; otherwise **+ → App IDs → App**, bundle ID
`ng.heynaija.app`, explicit). Under **Capabilities**, tick:

- **Push Notifications**
- **Sign In with Apple** (Enable as a primary App ID)
- **App Groups**, with the group `group.ng.heynaija.app` (made under
  **Identifiers → App Groups** if it is not there): the app and its notification
  extension share the key that opens notifications through it.

Then **Identifiers → +** → the extension's ID, `ng.heynaija.app.NotificationService`,
with **App Groups** ticked and the same group. Xcode's automatic signing does both
of these itself once the team is set, but the capabilities above must be on.

## 2. The key

**Keys → +**:

1. Name it `HeyNaija server`.
2. Tick **Apple Push Notifications service (APNs)** and **Sign in with Apple**.
   Configure Sign in with Apple with `ng.heynaija.app` as its primary App ID. For
   APNs choose **Sandbox & Production**.
3. **Register**, then **Download**. The `.p8` file downloads once only. Note the
   **Key ID** shown with it, and the **Team ID** (top right of the developer site,
   or **Membership details**).
4. Put it in the password manager with both IDs, and delete the download after
   step 3 below.

## 3. The servers

As `heynaija`, in `/srv/heynaija/infra/deploy/.env` on each server (the same key
serves staging and production; the key file goes in as one line of base64):

```bash
printf 'APPLE_PRIVATE_KEY=%s\n' "$(base64 -i ~/Downloads/AuthKey_ABC123DEFG.p8 | tr -d '\n')" | ssh heynaija@<server-ip> 'cat >> /srv/heynaija/infra/deploy/.env'
```

and the two IDs:

```text
APPLE_TEAM_ID=<team ID>
APPLE_KEY_ID=<key ID>
```

Sign in with Apple also needs Kratos's social sign-in on, which `GOOGLE_SIGN_IN=true`
switches on for Google and Apple together ([google-sign-in.md](google-sign-in.md)).

Deploy again (or `./deploy.sh <current commit>`). The API refuses to start with only
some of the three set, naming what is missing.

## 4. Email to members who hide their address

A member can join with Apple and **Hide My Email**: their account's address is
then one of Apple's relay addresses (`…@privaterelay.appleid.com`), and Apple
passes on only mail from senders registered with it. Without this step they get no
sign-in codes, so they can sign in only with Apple.

Apple checks that the domain it is told about passes SPF. HeyNaija's mail comes
from `mail.heynaija.ng` (the `SMTP_FROM_ADDRESS` is `no-reply@mail.heynaija.ng`),
whose DKIM key Resend set up; Resend's SPF record is on `send.mail.heynaija.ng`,
the address bounces go to, and `mail.heynaija.ng` itself has none. So first, in the
DNS for `heynaija.ng`, add a TXT record that points to Resend's:

| Type | Name | Content |
| --- | --- | --- |
| TXT | `mail` | `v=spf1 include:send.mail.heynaija.ng ~all` |

Then **Certificates, Identifiers & Profiles → Services → Sign in with Apple for
Email Communication → Configure → +**: under **Domains and Subdomains**
`mail.heynaija.ng`, and under **Email Addresses** `no-reply@mail.heynaija.ng`. Each
shows a green tick once Apple has found the SPF record; a new record can take a few
minutes to be seen. If the sending address ever changes, register the new one.

## Checking it

- **Sign in with Apple:** in the iOS app on a phone, signed in to an Apple Account,
  **Continue with Apple** and join with an invite. Then on the web, Settings shows
  **Disconnect Apple** under Connected accounts.
- **Revoking:** after that sign-in, `select count(*) from apple_tokens` is 1 more.
  Deleting the account and letting it erase takes it away again, and the Apple
  Account's **Sign in with Apple** settings no longer list HeyNaija.
- **Push:** turn notifications on in the app and have someone like a post. A build
  run from Xcode goes through Apple's sandbox, an App Store or TestFlight build
  through production; both work with the same key. If nothing arrives, the API's
  log has a line for each refusal (`push to app … was refused for good: APNs
  answered 403 InvalidProviderToken` means the team ID, key ID or key is wrong).
