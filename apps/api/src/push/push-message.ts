import { type DigestItem, linesFor } from '../email/digest.js'
import type { PushMessage } from './push-sender.js'

/**
 * A notification as the push job sees it. `pending` ones are what is being
 * pushed now. The others were pushed earlier and are still unread: likes,
 * reposts and follows, there only so that "@a liked your post" can become
 * "@b and @a liked your post" when @b's like arrives.
 */
export type PushItem = DigestItem & { id: string; pending: boolean }

/** Most push notifications a member is sent at once; past this they get one that says how many. */
export const MESSAGES_MAX = 3

/**
 * Which notification on the device a message replaces. Everything about one post
 * (or, for follows and most moderation notices, everything of one kind) is one
 * notification on the device, updated as more happens.
 */
const tagOf = (item: DigestItem): string => {
  switch (item.kind) {
    case 'reply':
    case 'quote':
    case 'mention':
    case 'like':
    case 'repost':
    case 'idea_status':
      return `${item.kind}:${item.postId}`
    case 'moderator_granted':
    case 'moderator_revoked':
      return `${item.kind}:${item.community}`
    default:
      return item.kind
  }
}

/**
 * The push notifications for what is waiting, in the email's words (digest.ts):
 * the same grouping, the same short quotes, and moderation decisions in general
 * words with no post text. Oldest first, so the newest ends up on top. `pushed`
 * is every waiting notification the messages tell the member about.
 */
export function pushMessages(items: PushItem[]): { messages: PushMessage[]; pushed: string[] } {
  // Links are paths: the service worker opens them on its own site.
  const lines = linesFor(items, '').filter((line) => line.items.some((item) => item.pending))
  const pending = lines.flatMap((line) => line.items.filter((item) => item.pending).map((item) => item.id))
  if (lines.length > MESSAGES_MAX) {
    return {
      messages: [{ title: `${pending.length} new notifications`, body: 'See them in HeyNaija.', url: '/notifications', tag: 'many' }],
      pushed: pending,
    }
  }
  return {
    messages: lines
      .map((line) => ({ title: line.headline, body: line.quote ? `“${line.quote}”` : '', url: line.href, tag: tagOf(line.items[0]!) }))
      .reverse(),
    pushed: pending,
  }
}
