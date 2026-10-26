export const CDN_PURGER = Symbol('CDN_PURGER')

/**
 * Drops files from the CDN's cache. Published images are cached for a year
 * (they never change), so taking one down in storage is not enough: the cached
 * copy would go on being served.
 */
export interface CdnPurger {
  /** `keys` are media-bucket keys, such as `posts/<id>/640.webp`. Throws when the CDN refuses. */
  purge(keys: string[]): Promise<void>
}

/** For development and tests, where nothing sits in front of storage. */
export class NoPurger implements CdnPurger {
  async purge(): Promise<void> {}
}

// Cloudflare's limit on URLs in one purge request (the lowest across plans).
const URLS_PER_REQUEST = 30

/**
 * Purges by URL through Cloudflare's API. Each key is purged under every public
 * address it is served from: the site's `/media/` path (nginx in front of the
 * bucket) and the bucket's own custom domain.
 */
export class CloudflarePurger implements CdnPurger {
  constructor(
    private readonly zoneId: string,
    private readonly token: string,
    /** Each ends without a slash, such as `https://heynaija.ng/media`. */
    private readonly bases: string[],
    private readonly fetchFn: typeof fetch = fetch,
  ) {}

  async purge(keys: string[]): Promise<void> {
    const urls = keys.flatMap((key) => this.bases.map((base) => `${base}/${key}`))
    for (let i = 0; i < urls.length; i += URLS_PER_REQUEST) {
      const res = await this.fetchFn(`https://api.cloudflare.com/client/v4/zones/${this.zoneId}/purge_cache`, {
        method: 'POST',
        headers: { authorization: `Bearer ${this.token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ files: urls.slice(i, i + URLS_PER_REQUEST) }),
        signal: AbortSignal.timeout(15_000),
      })
      const body = (await res.json().catch(() => null)) as { success?: boolean; errors?: { message: string }[] } | null
      if (!res.ok || !body?.success) {
        throw new Error(`Cloudflare purge failed (${res.status}): ${body?.errors?.map((e) => e.message).join('; ') || 'no details'}`)
      }
    }
  }
}
