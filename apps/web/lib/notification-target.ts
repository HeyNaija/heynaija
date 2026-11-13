import type { Notification } from './api'
import { postedReplyHref } from './posted-href.ts'

/** Open the actual item, including its position in a conversation. */
export function notificationTarget(n: Pick<Notification, 'kind' | 'post' | 'actor' | 'community' | 'challenge' | 'game'>): string | null {
  switch (n.kind) {
    case 'reply':
    case 'like':
    case 'repost':
    case 'quote':
    case 'mention':
    case 'post_restored':
    case 'post_labelled':
    case 'idea_status':
    case 'story_update':
      if (!n.post) return null
      return postedReplyHref(n.post.gistId, n.post.id)
    case 'follow':
      return n.actor ? `/u/${n.actor.handle}` : null
    case 'avatar_removed':
    case 'profile_cleared':
      return '/settings'
    case 'moderator_granted':
      return '/mod'
    case 'moderator_revoked':
      return n.community ? `/c/${n.community.slug}` : null
    case 'chess_challenge':
      return n.challenge ? `/games/chess#challenge-${n.challenge.id}` : '/games/chess'
    case 'chess_game_started':
      return n.game ? `/games/chess/games/${n.game.id}` : '/games/chess'
    default:
      return null
  }
}
