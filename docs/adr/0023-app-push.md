# ADR 0023 — Push notifications reach the Android app through FCM, as data the app shows itself

**Date:** 7 November 2026 · **Status:** Accepted · **Amends:** [ADR 0011](0011-push-notifications.md) ·
**Related:** [ADR 0022](0022-app-sessions.md), the apps' repository `HeyNaija/heynaija-mobile`

## Decision

The Android app gets the same push notifications as a browser: what is pushed,
when, in which words, and what it replaces are all ADR 0011's, decided by the same
job (`PushNotificationsService.send`). Only the last step differs. A browser is
sent Web Push; the app is sent a message through **Firebase Cloud Messaging**
(FCM) to the token Firebase gave that installation.

- **One row per installation** in `push_devices` (migration 0038): the member, the
  push service (`fcm`), the token, and the installation's key (below). It is a
  table of its own, not more rows in
  `push_subscriptions`, whose address and keys an app does not have; older code
  rolled back onto the new schema never sees it.
- **Registering.** The app sends its token and key to `POST /v1/push/devices` each
  time it starts signed in, and again when Firebase gives it a new token. A token is one
  installation, so it moves to whoever signs in there, with a fresh start date.
  Signing out sends `POST /v1/push/devices/remove` before ending the session.
  Without the server's FCM key the route answers 404 and the app does not ask
  for notification permission.
- **Sealed data messages.** The message has no `notification` part and one data
  field, `sealed`: the browser's four fields (`title`, `body`, `url`, `tag`) and
  `member`, the recipient's ID, as JSON encrypted with AES-256-GCM under a key the
  app made for itself when it was installed (a 12-byte nonce, the ciphertext, the
  16-byte tag, in base64url). FCM carries it without being able to read it, which
  is what Web Push gives a browser. The app opens it and builds the notification
  itself, so it looks and behaves the same
  whether the app is open or not, a newer one with the same tag replaces the last,
  and tapping it opens `url` inside the app. An app that is signed out, or signed
  in as someone else, drops a message for another member instead of showing it.
  Android priority is high and the time to live is a day, as for browsers.
- **Signing in to FCM.** The server holds the Firebase project's service account
  key (`FCM_SERVICE_ACCOUNT`, the JSON in base64) and signs its own JWT for
  Google's token endpoint (RFC 7523), keeping the hour-long access token until a
  few minutes before it runs out. No Firebase SDK on the server.
- **Errors.** `UNREGISTERED` and `SENDER_ID_MISMATCH` delete the row, as 404 and
  410 do for a browser. Other 4xx answers are logged and the notification is left
  to email; 401 drops the access token; 429 and 5xx retry. A 404 without
  `UNREGISTERED` (a wrong project ID) deletes nothing.
- **Data export** lists each installation's start and last push, without the
  token, as it does for browsers (`appPushNotifications`). Deleting the account
  deletes the rows.

## Why

FCM is the only way to wake an Android app that is not running; Google Play
services keeps the one connection for every app on the phone. Unlike Web Push, FCM
does not encrypt what it carries for the device: Google could read who replied and
the start of what they said. The privacy notice tells members that the push
service cannot read their notifications, so the app's are sealed before they leave
the server; the key lives in the phone's keystore and in `push_devices`, never at
Google. Data messages cost
the app a few lines of code and give one path for every case, where `notification`
messages are shown by the system while the app is in the background and handed to
the app while it is open, and could not be dropped when they are another member's.

Signing the JWT ourselves is about forty lines against `firebase-admin`'s
dependency tree, for the one call we make.

The Android app is built with `google-services.json` from the same Firebase project.
That file is not secret (every copy of the app carries it), but the repository is
public and nothing gains from it being there: CI writes it from a secret, and a
build without it simply has no push.

## Not yet

- **iOS.** The Apple developer account is pending. The plan is APNs directly, with
  an `.p8` key, as a second `service` (`apns`) in `push_devices`, so that iOS needs
  no Firebase SDK.
- **Notification channels per kind.** One channel for now; Android's settings can
  then only turn all of HeyNaija's notifications on or off. The per-kind choices in
  the app's Settings still apply, as on the web.
