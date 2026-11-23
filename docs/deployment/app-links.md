# Links that open the apps

Every heynaija.ng link opens in the HeyNaija app when it is installed
(HeyNaija/heynaija-mobile), and in the browser when it is not. The apps claim the
whole site once, so a new feature never needs a list changed, or an Android
release, for its links.

## The rule

The app decides what each link does. The website follows rules 2 and 3 too.

1. **The app has a screen for the page.** The screen opens.
2. **The person is signed out and the page needs an account.** They sign in first.
   Then the linked page opens.
3. **The person is signed in but can't see the page.** For example, Games is not
   open to them. A short message says why. Nothing just fails, and nobody is
   shown "page not found".
4. **The app has no screen for the page yet.** The page opens in the browser.
5. **The page must stay on the website.** These are the sign-in steps, email
   confirmation, unsubscribing, downloads, Lichess's callbacks, Keno, and `/flash`,
   which only the website's own pages call. The phone never gives them to the app.

## Every page is marked

`PAGES` in `apps/web/lib/app-links.ts` lists every page and route of the site, each
marked one of these:

- `app`: the app has a screen for it (rule 1).
- `browser`: the app has no screen for it yet (rule 4).
- `website`: it must stay on the website (rule 5).

`apps/web/tests/app-links.test.mjs` fails in CI when a page under `app/` is not in
`PAGES`. So a pull request that adds a page also decides where it opens. The mobile
repository's `LinksTest.kt` keeps a copy of the list, and checks the app has a screen
for every `app` page.

A new `app` or `browser` page needs nothing else: the phones already give it to the
app. When the app gets a screen for a `browser` page, the app release that adds the
screen is enough. Mark the page `app` here at the same time.

A new `website` page is left out of both phone files by this list. The iPhone
picks that up within a day. Android 15 and later pick it up within a week. Older
Android still gives it to the app, and the app hands it straight to the browser.

## The two files

The site serves two files for it:

- `/.well-known/apple-app-site-association` (iOS, Universal Links). Names the iOS
  app (team `P6YA592CLG`, bundle `ng.heynaija.app`). It gives the app every page
  (`/*`) except the `website` pages and the addresses that are not pages (`/api`,
  `/kratos`, `/media`, `/_next`). It is the same on every server and needs no
  setting. Apple's CDN fetches it when the app is installed or updated, and keeps it
  for up to a day.
- `/.well-known/assetlinks.json` (Android, App Links). Names the Android app and
  Google Play's app signing certificate, which signs every copy Play delivers
  (testing tracks too). It is in the code (`PLAY_SIGNING_SHA256`), from Play
  Console → Test and release → **App integrity**. Play made the key once and it does
  not change, so this needs no setting either. The app's manifest claims every
  page. Android 15 and later also read the pages to leave out from this file
  (`dynamic_app_link_components`), the same ones as Apple's.

## Android 14 and older

Android 14 and older can't read the pages to leave out, so they give the app every
heynaija.ng link. The app hands the `website` ones straight to the browser.

One case looks odd there. A sign-in that comes back to heynaija.ng from another
site passes through the app on its way to the browser. Examples are signing in with
Google on the website, and connecting Lichess on the website. Chrome gives the
returning link to the app. The app passes it back, and the sign-in finishes in a new
Chrome tab. It works, but the app flashes up and a second tab opens. It needs the
HeyNaija app installed, and the person signing in on the website in Chrome.

A sign-in that came back with a form POST would lose its form there. None does
today: the website does not offer Sign in with Apple.

## Releasing a change to the phone files

Older app versions do nothing with a link they have no screen for. So when the files
start giving the app more pages, the app version that can handle them must be live
first. The change of 20 November 2026 (every page) needs HeyNaija/heynaija-mobile's
link handler in the stores, and on most phones, before it reaches production.

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
