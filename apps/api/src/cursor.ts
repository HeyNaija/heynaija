import { z } from 'zod'

// Pages of newest-first lists continue from the last row's time and ID, encoded
// so the cursor is opaque to callers.

export class InvalidCursorError extends Error {}

export const encodeCursor = (createdAt: Date, id: string) =>
  Buffer.from(JSON.stringify([createdAt.toISOString(), id])).toString('base64url')

export const decodeCursor = (cursor: string): [Date, string] => {
  const [iso, id] = decodeExactCursor(cursor)
  return [new Date(iso), id]
}

// Lists ordered in SQL keep the database's microseconds, which a JavaScript date
// would round away; these carry the time as text instead. Same format as above.

export const encodeExactCursor = (at: string, id: string) =>
  Buffer.from(JSON.stringify([at, id])).toString('base64url')

export const decodeExactCursor = (cursor: string): [string, string] => {
  try {
    return z.tuple([z.iso.datetime(), z.uuid()]).parse(JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')))
  } catch {
    throw new InvalidCursorError('invalid cursor')
  }
}
