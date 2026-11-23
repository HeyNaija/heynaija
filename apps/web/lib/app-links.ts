/**
 * The files that let a link to this site open in the HeyNaija apps
 * (HeyNaija/heynaija-mobile) instead of the browser: iOS fetches
 * /.well-known/apple-app-site-association (Universal Links) and Android
 * /.well-known/assetlinks.json (App Links). Each names the app that may open
 * them.
 *
 * The apps claim every page, once, so that a new feature never needs these lists
 * or an Android release changed for its links (docs/deployment/app-links.md). The
 * app decides what each link does: it opens its screen for the page, or hands the
 * page to the browser. Only the pages that must stay on the website are left out
 * here, so the phone never gives them to the app.
 */

/**
 * Where a page opens on a phone that has the app:
 * - `app`: the app has a screen for it, and opens it.
 * - `browser`: the app has no screen for it yet, so it hands the page to the browser.
 * - `website`: it must stay on the website, so the phone never gives it to the app:
 *   signing in, unsubscribing, downloads, Lichess's callbacks, and Keno while the
 *   Apple developer account is an individual's.
 */
export type Opens = 'app' | 'browser' | 'website'

/**
 * Every page and route of the site (app/), by its folder path without route
 * groups, and where it opens. tests/app-links.test.mjs fails when a page is
 * missing, so each new page decides this in its own pull request. The mobile
 * repository's link tests (shared/.../nav/LinksTest.kt) keep a copy.
 */
export const PAGES = {
  '/': 'app',
  '/about': 'browser',
  '/about/discover': 'browser',
  '/about/highlights': 'browser',
  '/about/keke': 'browser',
  '/auth-error': 'website',
  '/birth-date': 'website',
  '/bookmarks': 'app',
  '/c': 'app',
  '/c/[slug]': 'app',
  '/charter': 'browser',
  '/child-safety': 'browser',
  '/email-off': 'website',
  '/games': 'app',
  '/games/chess': 'app',
  '/games/chess/callback': 'website',
  '/games/chess/games/[id]': 'app',
  '/games/chess/teams/[slug]': 'app',
  '/games/competitions': 'app',
  '/games/competitions/[id]': 'app',
  '/games/competitions/[id]/edit': 'browser',
  '/games/competitions/new': 'browser',
  // Simulated gambling: kept out of the App Store build (an individual's Apple account), and out of Android with it.
  '/games/keno': 'website',
  '/games/keno/leaderboard': 'website',
  '/games/keno/rounds': 'website',
  '/games/keno/rounds/[number]': 'website',
  '/games/keno/tickets': 'website',
  '/games/leaderboard': 'app',
  '/games/scoring': 'app',
  '/games/trivia': 'app',
  '/games/trivia/host': 'browser',
  '/games/trivia/rounds/[id]': 'app',
  '/games/trivia/rounds/[id]/edit': 'browser',
  '/games/trivia/rounds/[id]/host': 'browser',
  // What proxy.ts shows at a Games or Gist address to someone signed out, or without Games.
  '/games-not-open': 'website',
  '/games-sign-in': 'website',
  '/gist-sign-in': 'website',
  '/gists/[id]': 'app',
  '/gists/new': 'browser',
  '/governance': 'browser',
  '/governance/constitution': 'browser',
  '/governance/membership': 'browser',
  '/governance/verification': 'browser',
  '/hashtag/[tag]': 'app',
  '/ideas': 'browser',
  '/ideas/new': 'browser',
  '/join': 'app',
  '/licence': 'browser',
  '/lichess/return': 'website',
  '/login': 'website',
  '/logout': 'website',
  '/mod': 'browser',
  '/notifications': 'app',
  '/p/[id]': 'app',
  '/p/[id]/quote': 'app',
  '/p/[id]/votes': 'browser',
  '/privacy': 'browser',
  '/progress': 'browser',
  '/report': 'browser',
  '/rules': 'browser',
  '/search': 'app',
  '/settings': 'app',
  '/settings/delete': 'app',
  '/settings/delete/refused/[reason]': 'browser',
  '/settings/delete/scheduled': 'browser',
  '/settings/export': 'website',
  '/signup': 'website',
  '/terms': 'browser',
  '/topics': 'browser',
  '/u/[handle]': 'app',
  '/verification': 'website',
  '/welcome': 'website',
  '/.well-known/apple-app-site-association': 'website',
  '/.well-known/assetlinks.json': 'website',
} as const satisfies Record<string, Opens>

/** Addresses on the site that are not pages (next.config.ts rewrites, and Next's own files): never the app's. */
export const NOT_PAGES = ['/api/*', '/kratos/*', '/media/*', '/_next/*'] as const

/** A page's folder path as a pattern both phones read: `*` for each `[param]`. */
const pattern = (page: string) => page.replace(/\[[^\]]+\]/g, '*')

/**
 * The pages the phone never gives to the app, as path patterns, in a fixed order:
 * the website-only pages, then the addresses that are not pages.
 */
export function websiteOnly(): string[] {
  const pages = Object.entries(PAGES).filter(([, opens]) => opens === 'website').map(([page]) => pattern(page))
  return [...pages, ...NOT_PAGES]
}

/** The iOS app: its team and bundle ID. Not secret: every signed copy of the app carries both. */
export const IOS_APP_ID = 'P6YA592CLG.ng.heynaija.app'

/** The Android app's package name. */
export const ANDROID_PACKAGE = 'ng.heynaija.app'

/**
 * Google Play's app signing key for the Android app (Play Console → Test and
 * release → App integrity), which signs every copy Play delivers, testing tracks
 * included. Play made it once and it does not change. Not secret: it is in every
 * copy of the app, and this file is public.
 */
export const PLAY_SIGNING_SHA256 = '1C:55:B3:F9:4A:D6:55:54:A5:9F:F5:47:A3:0F:98:09:52:94:EA:8C:57:EB:C1:31:13:98:DA:1A:6B:35:3C:51'

/**
 * Apple's file: every page, except the website-only ones (left out first, since
 * the first pattern a path matches decides). `*` is any run of characters, `/`
 * included; the query is not looked at.
 */
export function appleAppSiteAssociation() {
  return {
    applinks: {
      details: [
        {
          appIDs: [IOS_APP_ID],
          components: [
            ...websiteOnly().map((path) => ({ '/': path, exclude: true })),
            { '/': '/*', comment: 'Every other page: the app opens its screen, or hands it to the browser' },
          ],
        },
      ],
    },
  }
}

/** A certificate's SHA-256 as Play Console and keytool show it: 32 bytes in hex, colon-separated. */
const FINGERPRINT = /^([0-9A-F]{2}:){31}[0-9A-F]{2}$/

/**
 * More certificates than Play's, from ANDROID_CERT_SHA256, normally unset: only
 * for a build signed some other way that should open the links too, such as the
 * upload key's release build installed without Play. Comma- or space-separated;
 * with or without the colons. Anything that is not a SHA-256 comes back in
 * `invalid`, to be reported, instead of quietly matching nothing.
 */
export function certFingerprints(value: string | undefined): { valid: string[]; invalid: string[] } {
  const valid: string[] = []
  const invalid: string[] = []
  for (const raw of (value ?? '').split(/[\s,]+/).filter(Boolean)) {
    const hex = raw.toUpperCase().replace(/:/g, '')
    const print = /^[0-9A-F]{64}$/.test(hex) ? hex.match(/../g)!.join(':') : raw
    if (FINGERPRINT.test(print)) {
      if (!valid.includes(print)) valid.push(print)
    } else {
      invalid.push(raw)
    }
  }
  return { valid, invalid }
}

/**
 * Google's Digital Asset Links statement: Play's certificate, then any [extra]
 * ones. Android 15 and later also read the pages to leave out from it (dynamic App
 * Links), so those open in the browser without passing through the app; older
 * Android ignores them, and the app hands those pages to the browser itself. The
 * first rule a path matches decides, and a path no rule matches stays in the
 * browser, hence the last one.
 */
export function assetLinks(extra: string[] = []) {
  const fingerprints = [PLAY_SIGNING_SHA256, ...extra.filter((print) => print !== PLAY_SIGNING_SHA256)]
  return [
    {
      relation: ['delegate_permission/common.handle_all_urls'],
      relation_extensions: {
        'delegate_permission/common.handle_all_urls': {
          dynamic_app_link_components: [...websiteOnly().map((path) => ({ '/': path, exclude: true })), { '/': '*' }],
        },
      },
      target: { namespace: 'android_app', package_name: ANDROID_PACKAGE, sha256_cert_fingerprints: fingerprints },
    },
  ]
}
