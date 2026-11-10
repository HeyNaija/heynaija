# Links that open the apps

A link to a post, Gist, profile, community or hashtag on heynaija.ng opens in the
HeyNaija app when it is installed (HeyNaija/heynaija-mobile), and in the browser
when it is not. Every other page (the rules, settings, signing up, a post's quote
and votes pages) always opens in the browser. Which pages is set in one place,
`apps/web/lib/app-links.ts`, and the Android app's manifest lists the same ones.

The site serves two files for it:

- `/.well-known/apple-app-site-association` (iOS, Universal Links). Names the iOS
  app (team `P6YA592CLG`, bundle `ng.heynaija.app`) and the pages. It is the same
  on every server and needs no setting. Apple's CDN fetches it when the app is
  installed or updated, and keeps it for up to a day.
- `/.well-known/assetlinks.json` (Android, App Links). Names the Android app and
  the certificates it is signed with, from `ANDROID_CERT_SHA256` in the server's
  `.env`. Unset, it is an empty list, and Android opens the links in the browser.

## Setting the Android certificates (production, once)

After the first upload to Google Play:

1. Play Console → Test and release → **App integrity** → App signing. Copy the
   **SHA-256** of the app signing key certificate. It is Play's key, not the
   upload key: what Play delivers to phones is signed with it.
2. The upload key's SHA-256, for a release build installed without Play:
   `keytool -list -v -keystore heynaija-upload.jks` (it asks for the keystore's
   password).
3. In `/srv/heynaija/infra/deploy/.env`:

   ```bash
   ANDROID_CERT_SHA256=<Play's SHA-256>,<the upload key's SHA-256>
   ```

   then `docker compose up -d web` there, or deploy again. A value that is not a
   SHA-256 is left out and logged by the web container.

## Checking

```bash
curl -sS https://heynaija.ng/.well-known/apple-app-site-association
curl -sS https://heynaija.ng/.well-known/assetlinks.json
```

Both answer 200 with JSON and no redirect. What Apple's CDN holds:
`curl -sS https://app-site-association.cdn-apple.com/a/v1/heynaija.ng`. What
Google makes of it:
`https://digitalassetlinks.googleapis.com/v1/statements:list?source.web.site=https://heynaija.ng&relation=delegate_permission/common.handle_all_urls`.

On an Android phone with the app from Play,
`adb shell pm get-app-links ng.heynaija.app` should show `heynaija.ng: verified`.
Android checks when the app is installed, so after changing the setting,
`adb shell pm verify-app-links --re-verify ng.heynaija.app` checks again.

Cloudflare has to let Apple's and Google's fetchers through: a bot challenge on
`/.well-known/*` stops the links working without any error to see here.
