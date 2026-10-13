import { type Db, members, posts } from '@heynaija/db'
import { Inject, Injectable } from '@nestjs/common'
import { and, desc, eq, isNull, lt, or } from 'drizzle-orm'
import { z } from 'zod'
import { DB } from '../tokens.js'

export const POST_MAX_GRAPHEMES = 300

const segmenter = new Intl.Segmenter()
const graphemes = (text: string) => [...segmenter.segment(text)].length

// Counted in graphemes so an emoji or an accented letter is one character, as
// the person typing sees it.
export const postText = z
  .string()
  .trim()
  .min(1, 'post is empty')
  .refine((t) => t.length <= POST_MAX_GRAPHEMES * 16 && graphemes(t) <= POST_MAX_GRAPHEMES, {
    message: `post is longer than ${POST_MAX_GRAPHEMES} characters`,
  })

export type FeedPost = {
  id: string
  authorId: string
  authorHandle: string
  text: string
  createdAt: Date
}

export type FeedPage = { posts: FeedPost[]; cursor: string | null }

export class InvalidCursorError extends Error {}

const encodeCursor = (createdAt: Date, id: string) =>
  Buffer.from(JSON.stringify([createdAt.toISOString(), id])).toString('base64url')

const decodeCursor = (cursor: string): [Date, string] => {
  try {
    const [iso, id] = z
      .tuple([z.iso.datetime(), z.uuid()])
      .parse(JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')))
    return [new Date(iso), id]
  } catch {
    throw new InvalidCursorError('invalid cursor')
  }
}

@Injectable()
export class PostsService {
  constructor(@Inject(DB) private readonly db: Db) {}

  async create(authorId: string, text: string): Promise<{ id: string }> {
    const [row] = await this.db.insert(posts).values({ authorId, text }).returning({ id: posts.id })
    return row!
  }

  /** Soft-deletes the post only if it belongs to `authorId`. */
  async remove(authorId: string, id: string): Promise<boolean> {
    const rows = await this.db
      .update(posts)
      .set({ deletedAt: new Date() })
      .where(and(eq(posts.id, id), eq(posts.authorId, authorId), isNull(posts.deletedAt)))
      .returning({ id: posts.id })
    return rows.length > 0
  }

  /** Newest first. Deleted posts and posts by inactive members are excluded. */
  async feed(limit: number, cursor?: string): Promise<FeedPage> {
    const conditions = [isNull(posts.deletedAt), eq(members.active, true)]
    if (cursor) {
      const [createdAt, id] = decodeCursor(cursor)
      conditions.push(
        or(lt(posts.createdAt, createdAt), and(eq(posts.createdAt, createdAt), lt(posts.id, id)))!,
      )
    }

    const rows = await this.db
      .select({
        id: posts.id,
        authorId: posts.authorId,
        authorHandle: members.handle,
        text: posts.text,
        createdAt: posts.createdAt,
      })
      .from(posts)
      .innerJoin(members, eq(members.id, posts.authorId))
      .where(and(...conditions))
      .orderBy(desc(posts.createdAt), desc(posts.id))
      .limit(limit + 1)

    const page = rows.slice(0, limit)
    const last = page.at(-1)
    return {
      posts: page,
      cursor: rows.length > limit && last ? encodeCursor(last.createdAt, last.id) : null,
    }
  }
}
