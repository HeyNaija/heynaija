import { z } from 'zod'
import { InvalidCursorError } from '../cursor.js'

// Unlike feed cursors, reply cursors retain PostgreSQL's microseconds. Passing
// this timestamp through Date would make ascending pages repeat or skip rows.
const cursorValue = z.tuple([z.literal(1), z.uuid(), z.literal('asc'), z.iso.datetime(), z.uuid()])

export const replyPageQuery = z.object({
  limit: z.coerce.number().int().min(1).max(20).default(20),
  cursor: z.string().min(1).max(200).optional(),
})

export const encodeReplyCursor = (parentId: string, timestamp: string, id: string): string =>
  Buffer.from(JSON.stringify([1, parentId, 'asc', timestamp, id])).toString('base64url')

export function decodeReplyCursor(cursor: string, parentId: string): [string, string] {
  try {
    if (cursor.length > 200) throw new Error('cursor too long')
    const [, scope, , timestamp, id] = cursorValue.parse(JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')))
    if (scope !== parentId) throw new Error('wrong parent')
    return [timestamp, id]
  } catch {
    throw new InvalidCursorError('invalid reply cursor')
  }
}
