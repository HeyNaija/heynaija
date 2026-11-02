import { z } from 'zod'

// Pages of newest-first lists continue from the last row's time and ID, encoded
// so the cursor is opaque to callers.

export class InvalidCursorError extends Error {}

/** Any JSON value as an opaque cursor. */
export const packCursor = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url')

/** What a packCursor cursor holds, if `schema` accepts it; anything else is an InvalidCursorError. */
export function unpackCursor<T>(schema: z.ZodType<T>, cursor: string): T {
  try {
    return schema.parse(JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')))
  } catch {
    throw new InvalidCursorError('invalid cursor')
  }
}

export const encodeCursor = (createdAt: Date, id: string) => packCursor([createdAt.toISOString(), id])

export const decodeCursor = (cursor: string): [Date, string] => {
  const [iso, id] = decodeExactCursor(cursor)
  return [new Date(iso), id]
}

// Lists ordered in SQL keep the database's microseconds, which a JavaScript date
// would round away; these carry the time as text instead. Same format as above.

export const encodeExactCursor = (at: string, id: string) => packCursor([at, id])

export const decodeExactCursor = (cursor: string): [string, string] =>
  unpackCursor(z.tuple([z.iso.datetime(), z.uuid()]), cursor)
