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
  Google Play's app signing certificate, which signs every copy Play delivers
  (testing tracks too). It is in the code (`PLAY_SIGNING_SHA256`), from Play
  Console → Test and release → **App integrity**, whose "Digital Asset Links
  JSON" is this same file. Play made the key once and it does not change, so
  this needs no setting either.

## Other builds (rarely)

A copy of the app that did not come from Play is signed with another key, so
Android does not open the links in it without asking. That is only builds people
install themselves: the upload key's release build from the Release workflow,
or a debug build. To have them verified on a server too, add their SHA-256s to
its `.env`, comma-separated, then `docker compose up -d web`:

```bash
ANDROID_CERT_SHA256=<SHA-256>,<SHA-256>
```

The upload key's is on the same App integrity page; a debug key's is in
`./gradlew :androidApp:signingReport`. A value that is not a SHA-256 is left out
and logged by the web container. For trying links on one phone, `adb` does
without any of this (the mobile repository's README).

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
