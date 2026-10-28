import { z } from 'zod'
import { InvalidCursorError } from '../cursor.js'
import { pageQuery } from '../http.js'

// The rules Discover ranks by (ADR 0014). They are sent with every page, and on
// their own for the page that explains them, so that page always states what
// this code does. Changing one amends the ADR.
export const DISCOVER_RULES = {
  /** Only top-level posts from this many hours before the moment Discover was opened. */
  windowHours: 72,
  /** Every post starts with this many, so a new post nobody has seen yet can still be seen. */
  startingPoints: 1,
  /** For each different member, other than the author, who replied anywhere in the conversation or quoted it. */
  conversationPoints: 2,
  /** For each like: the public count, nothing about who. */
  likePoints: 1,
  /** For each repost. */
  repostPoints: 1,
  /** More, for each person the reader follows among those who replied, quoted or reposted. */
  followedPoints: 3,
  /** When the reader follows the author. */
  followsAuthorPoints: 2,
  /** When it is in a community the reader joined. */
  joinedCommunityPoints: 1,
  /** score = points / (hours since posted + ageOffsetHours) ^ gravity */
  ageOffsetHours: 2,
  gravity: 1.5,
  /** Each author's second post is scored at this share, their third at its square, and so on. */
  authorDecay: 0.5,
  /** Discover ends after this many posts. */
  maxPosts: 100,
  /** Open reports from this many different members hold a post out until a moderator decides. */
  reportsToHold: 2,
  /** A member's own posts from this many minutes ago come first, so a post just written shows at once. */
  ownPostsMinutes: 60,
  /** For visitors who are not signed in the ranking is the same for everyone, worked out this often. */
  visitorRefreshSeconds: 60,
} as const

export type DiscoverRules = { [K in keyof typeof DISCOVER_RULES]: number }

/** How long the moment a reader opened Discover is kept when the page is loaded again (`at`). */
const MOMENT_KEPT_MS = 3_600_000

/**
 * The moment a first page is ranked as of: `at`, when the page is being loaded
 * again and asks for the same ranking as before, if it is no more than an hour
 * old; otherwise now.
 */
export function discoverMoment(at: string | undefined, now = Date.now()): string {
  const then = at ? Date.parse(at) : Number.NaN
  return Number.isFinite(then) && then <= now && now - then <= MOMENT_KEPT_MS ? new Date(then).toISOString() : new Date(now).toISOString()
}

// A mangled `at` (it comes from the page's address) is ignored rather than refused.
export const discoverPageQuery = pageQuery.extend({ at: z.string().max(64).optional() })

export type DiscoverPosition = { asOf: string; score: string; id: string }

// A page continues after the last post's score and ID, ranked as of the same
// moment as the first page. The score is carried as Postgres prints it, which
// reads back as the same number, so the boundary compares exactly.
const cursorValue = z.tuple([z.literal(1), z.iso.datetime(), z.string().regex(/^[0-9.e+-]{1,32}$/), z.uuid()])

export const encodeDiscoverCursor = ({ asOf, score, id }: DiscoverPosition): string =>
  Buffer.from(JSON.stringify([1, asOf, score, id])).toString('base64url')

export function decodeDiscoverCursor(cursor: string): DiscoverPosition {
  try {
    const [, asOf, score, id] = cursorValue.parse(JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')))
    if (!Number.isFinite(Number(score))) throw new Error('not a score')
    return { asOf, score, id }
  } catch {
    throw new InvalidCursorError('invalid discover cursor')
  }
}
