/** A post's GIF as the API sends it: which provider, its id there, and the author's description. */
export type GifTag = { provider: string; id: string; alt: string }

/** One result in the search: the provider's id, a title for its label, and a small rendition to show. */
export type GifHit = { id: string; title: string; src: string }

export type GifPage = { found: GifHit[]; next: number | null }

/**
 * One page of results: trending when `term` is empty. `retry` counts the member's Try again
 * presses, for a provider whose client keeps failed answers (GIPHY's does).
 */
export type GifSearch = (query: { term: string; offset: number; limit: number; retry: number }) => Promise<GifPage>

/**
 * A GIF provider in the web app. The member's browser searches it and readers' browsers load
 * its media directly; HeyNaija stores only `{ provider: id, id }` (docs/adr/0031-gif-providers.md).
 * Adding one is a file like ./giphy.ts and a line in ./providers.ts (and its key in ./composer.ts).
 */
export type GifProvider = {
  /** The name stored on posts. Never changes once GIFs are posted with it. */
  id: string
  label: string
  /** Also checked by the API (apps/api/src/gifs/registry.ts); tests/gif-providers.test.mjs keeps them equal. */
  idPattern: RegExp
  /** The search box's placeholder, as the provider asks it to read. */
  searchPlaceholder: string
  /** Under the search results and a picked GIF. */
  attribution: string
  /** Under a GIF in a post. */
  credit: string
  /** Its media addresses, built from a well-formed id only; null for any other. */
  media(id: string): { animatedUrl: string; stillUrl: string } | null
  /** Loads its search (with any client library, in a chunk of its own) for a key. */
  search(apiKey: string): Promise<GifSearch>
}
