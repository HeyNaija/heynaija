/** What the API says a reply answers: a preview, or a placeholder when the reader cannot see it. */
export type ReplyContext =
  | { unavailable?: false; id: string; authorHandle: string; authorName: string | null; authorAvatar: string | null; excerpt: string }
  | { unavailable: true }

export type ReplyContextView =
  | { kind: 'none' }
  | { kind: 'parent'; href: string; label: string; handle: string; name: string | null; avatar: string | null; excerpt: string }
  /** Nothing identifying: the parent is deleted, taken down, or by someone the reader cannot see. */
  | { kind: 'gone'; label: string }
  /** Older API responses carry no preview; the reply still points at its parent. */
  | { kind: 'link'; href: string; label: string }

/** What a reply row in a list shows above its text. */
export function replyContextView(post: { replyParentId: string | null; replyTo?: ReplyContext | null }): ReplyContextView {
  if (!post.replyParentId) return { kind: 'none' }
  const parent = post.replyTo
  if (parent === undefined) return { kind: 'link', href: `/p/${post.replyParentId}`, label: 'Replying to a post' }
  if (parent === null || parent.unavailable) return { kind: 'gone', label: 'Replying to a post that is no longer available' }
  return {
    kind: 'parent',
    href: `/p/${parent.id}`,
    label: `Replying to @${parent.authorHandle}`,
    handle: parent.authorHandle,
    name: parent.authorName,
    avatar: parent.authorAvatar,
    excerpt: parent.excerpt,
  }
}
