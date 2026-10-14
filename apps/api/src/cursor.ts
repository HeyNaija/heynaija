import { z } from 'zod'

// Pages of newest-first lists continue from the last row's time and ID, encoded
// so the cursor is opaque to callers.

export class InvalidCursorError extends Error {}

export const encodeCursor = (createdAt: Date, id: string) =>
  Buffer.from(JSON.stringify([createdAt.toISOString(), id])).toString('base64url')

export const decodeCursor = (cursor: string): [Date, string] => {
  try {
    const [iso, id] = z
      .tuple([z.iso.datetime(), z.uuid()])
      .parse(JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')))
    return [new Date(iso), id]
  } catch {
    throw new InvalidCursorError('invalid cursor')
  }
}
