import type { Notification } from './api'

/** Open the actual item, including its position in a conversation. */
export function notificationTarget(n: Pick<Notification, 'kind' | 'post' | 'actor' | 'community'>): string | null {
  switch (n.kind) {
    case 'reply':
    case 'like':
    case 'repost':
    case 'quote':
    case 'mention':
    case 'post_restored':
    case 'idea_status':
      return n.post ? `/p/${n.post.id}#post-${n.post.id}` : null
    case 'follow':
      return n.actor ? `/u/${n.actor.handle}` : null
    case 'avatar_removed':
    case 'profile_cleared':
      return '/settings'
    case 'moderator_granted':
      return '/mod'
    case 'moderator_revoked':
      return n.community ? `/c/${n.community.slug}` : null
    default:
      return null
  }
}
