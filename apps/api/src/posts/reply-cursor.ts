import { z } from 'zod'
import { InvalidCursorError } from '../cursor.js'

/**
 * A list of replies starts with those by the author of the post they answer
 * (group 0), then everyone else's (group 1). Each group is in time order:
 * newest first unless the reader asks for oldest first.
 */
export const REPLY_ORDERS = ['newest', 'oldest'] as const
export type ReplyOrder = (typeof REPLY_ORDERS)[number]
export type ReplyPosition = { group: 0 | 1; timestamp: string; id: string }

// Unlike feed cursors, reply cursors retain PostgreSQL's microseconds. Passing
// this timestamp through Date would make pages repeat or skip rows. A cursor is
// a position in one order, so it names that order and is refused in the other.
const cursorValue = z.tuple([z.literal(2), z.uuid(), z.enum(REPLY_ORDERS), z.union([z.literal(0), z.literal(1)]), z.iso.datetime(), z.uuid()])

export const replyOrderQuery = z.object({
  order: z.enum(REPLY_ORDERS).default('newest'),
})

export const replyPageQuery = replyOrderQuery.extend({
  limit: z.coerce.number().int().min(1).max(20).default(20),
  cursor: z.string().min(1).max(200).optional(),
})

export const encodeReplyCursor = (parentId: string, order: ReplyOrder, { group, timestamp, id }: ReplyPosition): string =>
  Buffer.from(JSON.stringify([2, parentId, order, group, timestamp, id])).toString('base64url')

export function decodeReplyCursor(cursor: string, parentId: string, order: ReplyOrder): ReplyPosition {
  try {
    if (cursor.length > 200) throw new Error('cursor too long')
    const [, scope, cursorOrder, group, timestamp, id] = cursorValue.parse(JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')))
    if (scope !== parentId) throw new Error('wrong parent')
    if (cursorOrder !== order) throw new Error('wrong order')
    return { group, timestamp, id }
  } catch {
    throw new InvalidCursorError('invalid reply cursor')
  }
}
