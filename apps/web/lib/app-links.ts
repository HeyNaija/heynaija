/**
 * The files that let a link to this site open in the HeyNaija apps
 * (HeyNaija/heynaija-mobile) instead of the browser: iOS fetches
 * /.well-known/apple-app-site-association (Universal Links) and Android
 * /.well-known/assetlinks.json (App Links). Each names the app that may open
 * them. Apple's file also says which links; on Android the app's own manifest
 * says that.
 *
 * Only pages the apps have a screen for are claimed, the same ones as the apps'
 * `routeOf` (shared/src/commonMain/kotlin/ng/heynaija/app/nav/Links.kt) and the
 * Android manifest's intent filter. Every other link (the rules, settings,
 * signing up, a quote or the votes on a post) still opens here.
 */

/** The iOS app: its team and bundle ID. Not secret: every signed copy of the app carries both. */
export const IOS_APP_ID = 'P6YA592CLG.ng.heynaija.app'

/** The Android app's package name. */
export const ANDROID_PACKAGE = 'ng.heynaija.app'

/** Exactly a post's or a Gist's ID: `?` is any one character in Apple's patterns. */
const ID = '????????-????-????-????-????????????'

/**
 * Apple's patterns: `*` is any run of characters, `/` included, so the pages
 * under a profile, community or hashtag are left out first. The first pattern a
 * path matches decides.
 */
export function appleAppSiteAssociation() {
  return {
    applinks: {
      details: [
        {
          appIDs: [IOS_APP_ID],
          components: [
            { '/': `/p/${ID}`, comment: 'A post and its replies' },
            { '/': `/gists/${ID}`, comment: 'A Gist, or a reply in one (?reply=)' },
            { '/': '/u/*/*', exclude: true },
            { '/': '/u/*', comment: 'A profile' },
            { '/': '/c/*/*', exclude: true },
            { '/': '/c/*', comment: 'A community' },
            { '/': '/hashtag/*/*', exclude: true },
            { '/': '/hashtag/*', comment: 'A hashtag' },
            { '/': '/notifications' },
            { '/': '/bookmarks' },
          ],
        },
      ],
    },
  }
}

/** A certificate's SHA-256 as Play Console and keytool show it: 32 bytes in hex, colon-separated. */
const FINGERPRINT = /^([0-9A-F]{2}:){31}[0-9A-F]{2}$/

/**
 * The Android app's signing certificates, from ANDROID_CERT_SHA256: Play's app
 * signing key (Play Console → Test and release → App integrity), and the upload
 * key's for a release build installed without Play. Comma- or space-separated;
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

/** Google's Digital Asset Links statement; empty, so nothing is verified, until a fingerprint is set. */
export function assetLinks(fingerprints: string[]) {
  if (fingerprints.length === 0) return []
  return [
    {
      relation: ['delegate_permission/common.handle_all_urls'],
      target: { namespace: 'android_app', package_name: ANDROID_PACKAGE, sha256_cert_fingerprints: fingerprints },
    },
  ]
}
