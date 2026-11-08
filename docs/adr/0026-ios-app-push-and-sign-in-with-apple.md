# ADR 0026 — The iOS app: push through APNs, sealed as for Android, and Sign in with Apple

**Date:** 8 November 2026 · **Status:** Accepted · **Amends:** [ADR 0022](0022-app-sessions.md),
[ADR 0023](0023-app-push.md) · **Related:** the apps' repository `HeyNaija/heynaija-mobile`

## Decision

### Push

The iOS app gets the same push notifications as a browser and the Android app,
decided by the same job (ADR 0011, ADR 0023). Only the last step differs: it is
sent through the **Apple Push Notification service** (APNs), directly, with no
Firebase SDK in the iOS app.

- **Two services in `push_devices`** (migration 0044): `apns` for App Store and
  TestFlight builds, whose tokens come from Apple's production service, and
  `apns_sandbox` for builds run from Xcode, whose tokens come from its sandbox. The
  app says which it is when it registers; a token sent to the wrong one is refused
  as `BadDeviceToken` and deleted.
- **Which services a server has.** `GET /v1/push/key` answers `appServices`: `fcm`
  with `FCM_SERVICE_ACCOUNT`, `apns` and `apns_sandbox` with the Apple key
  (`APPLE_TEAM_ID`, `APPLE_KEY_ID`, `APPLE_PRIVATE_KEY`). An app offers push only
  when its service is there; registering with another answers 404. `app` stays,
  meaning FCM, for Android builds from before. An installation whose service a
  server no longer has (its key was removed) is left alone, not pushed to.
- **Sealed, as for Android.** The message carries one field, `sealed`, the same
  AES-256-GCM box under the key the app made (ADR 0023). APNs needs a visible alert
  to wake the app's code, so the alert Apple carries says only "HeyNaija: You have
  a new notification", with `mutable-content`. The app's **notification service
  extension** opens `sealed` before the notification is shown and replaces the
  alert with what it says, and with the link to open. One it cannot open (another
  member's, or the key is gone) keeps the stand-in words.
- **Replacing.** A newer notification about the same thing replaces the last
  through `apns-collapse-id`, which is an HMAC of the tag under the app's key, so
  Apple learns which notifications replace which but not what they are about.
- **Signing in to APNs** is a JWT signed with the Apple key (ES256), kept for 40
  minutes: Apple refuses one over an hour old, and one renewed more often than
  every 20 minutes. APNs speaks only HTTP/2, so the server keeps one `node:http2`
  connection per service rather than using fetch.
- **Errors**, as for FCM: 410 and `BadDeviceToken`/`DeviceTokenNotForTopic` delete
  the row; 429 and 5xx retry; `ExpiredProviderToken` retries with a new JWT;
  anything else is logged and left to email.

### Sign in with Apple

The iOS app offers Sign in with Apple. Kratos's native flow (ADR 0022) takes the
ID token Apple's own sheet gives the app, as it takes Google's from Android:
`method: oidc`, `provider: apple`, the token and its nonce. Kratos checks it
against Apple's published keys, with the app's bundle ID as the audience. Apple
needs no secret for this, so the provider's web settings (a Services ID and key)
are left empty, and **the web does not offer Apple**: it hides Kratos's Apple
buttons and only lets a member disconnect Apple in Settings.

- **The same account policy as Google** (`infra/kratos/policy`): Apple must have
  verified the address, which must be the HeyNaija account's; an address that
  already has an account confirms an emailed code first, then Apple is connected
  without a new account or invite; joining with Apple still takes an invite and
  the age question. A member who hides their email from Apple joins with Apple's
  relay address, which then is their account's address.
- **Revoking on erase.** Apple requires an app with Sign in with Apple to revoke
  the member's tokens when they delete their account. Kratos keeps nothing it
  could revoke with, so after signing in with Apple the app sends the one-time
  authorization code Apple gave it to `POST /v1/apple/token`. The API trades it for
  a refresh token, signed in as the app with the Apple key, and keeps that in
  `apple_tokens`, one per member, a later sign-in replacing it. Erasing the account
  revokes it with Apple before the rows go, and the erase is tried again while
  Apple cannot be reached. A refresh token is no use without HeyNaija's Apple key.

One Apple key, with both services switched on, serves push and Sign in with Apple
on every server (docs/deployment/sign-in-with-apple.md).

## Why

APNs is the only way to wake an iOS app that is not running, as FCM is on Android.
FCM can deliver to iOS too, but only through APNs and with Firebase's SDK in the
app; going to APNs directly keeps the server's one way of sealing and the app
free of Firebase. The extension is what lets a sealed message still look like a
notification: without it, Apple would have to carry the words.

App Store Review Guideline 4.8 asks apps that offer a third-party sign-in to also
offer one that limits data to a name and email and lets the email be hidden. Sign
in with Apple is that, and it lets the iOS app offer Google later too.

## Not yet

- **Google on iOS.** Needs an iOS OAuth client in the same Google Cloud project and
  its ID among the Google provider's `additional_id_token_audiences`.
- **Apple on the web.** Needs a Services ID, its return URL and the key in the Apple
  provider's settings, and the web's Apple button.
- **Revoking when the code never arrived.** If the app could not send the code
  (offline, or Apple refused it), nothing is kept until the member next signs in
  with Apple. Members can also stop HeyNaija's access in their Apple Account's
  settings, which the privacy notice says.
