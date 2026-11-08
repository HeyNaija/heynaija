# Push notifications to the apps

The API pushes to the Android app through Firebase Cloud Messaging
([ADR 0023](../adr/0023-app-push.md)), and to the iOS app through Apple's push
service, with the Apple key described in [sign-in-with-apple.md](sign-in-with-apple.md)
([ADR 0026](../adr/0026-ios-app-push-and-sign-in-with-apple.md)). The rest of this
page is Android's. The Firebase project is `heynaija-ed259`.
Each server needs one setting, `FCM_SERVICE_ACCOUNT`; the app needs the project's
`google-services.json` at build time. Without the setting a server pushes to
browsers as before, and the app does not offer push.

## 1. The servers: the service account key

1. Firebase console → **Project settings** → **Service accounts** → **Generate new
   private key**. It downloads a JSON file. Make one for each server, so that one
   can be revoked without the other (Google Cloud console → **IAM & Admin** →
   **Service accounts** → the `firebase-adminsdk` account → **Keys**). Which
   language the console's snippet is shown in does not matter: the key is the same.
2. Name the downloads `staging-key.json` and `production-key.json`.
3. Add each to its server's `.env` as one line of base64. `.env` is loaded as
   shell, which the JSON's quotes and line breaks would break. From your computer,
   where the admin key logs in as `heynaija`:

   ```bash
   printf 'FCM_SERVICE_ACCOUNT=%s\n' "$(base64 -i ~/Downloads/production-key.json)" | ssh heynaija@<production-ip> 'cat >> /srv/heynaija/infra/deploy/.env'
   ```

   Otherwise copy the line (`... | pbcopy` on a Mac in place of the `ssh`), sign
   in as your admin user, `sudo -iu heynaija`, and paste it at the end of
   `/srv/heynaija/infra/deploy/.env`. On Linux, `base64 -w0 file` gives one line.
4. On the server, this must print `1`:

   ```bash
   grep -c '^FCM_SERVICE_ACCOUNT=' /srv/heynaija/infra/deploy/.env
   ```

5. Deploy again (or `./deploy.sh <current commit>`): the API reads it when it
   starts. Its log says `Push notifications are off` only when neither this nor
   the VAPID keys are set. A key the API cannot read stops it starting, with a
   message naming `FCM_SERVICE_ACCOUNT`.
6. Keep both keys and the new `.env` in the password manager, and delete the
   downloads.

## 2. The app: google-services.json

Firebase console → **Project settings** → **General** → the Android app
`ng.heynaija.app` → `google-services.json`. It goes to the mobile repository as an
Actions secret, which CI writes into the build:

```bash
gh secret set GOOGLE_SERVICES_JSON --repo HeyNaija/heynaija-mobile < ~/Downloads/google-services.json
```

For a build on your own computer, put it at `androidApp/google-services.json` in
the mobile checkout, where git ignores it. Without it the app builds and runs with
no push.

## Checking it

Sign in to the app on a phone (or an emulator with Google Play), allow
notifications, and have someone like one of your posts. Within about ten seconds
the phone shows it. If it does not, the API's log has a line for each push that
was refused (`push to app … was refused for good`). A token Firebase no longer
knows is deleted without a log line.
