'use server'

import { createPost, type ComposeState } from '@/app/actions'
import { renderThreadRow } from '@/app/ui/thread-row'
import { getPost, getReplies, getViewer } from '@/lib/api'
import type { ReplyOrder, ThreadRow } from '@/lib/thread-state'

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export type LoadedReplies = { rows: ThreadRow[]; cursor: string | null } | { error: string }

/** One explicit page, with authentication and visibility still decided by the API. */
export async function loadThreadReplies(
  id: string,
  cursor: string | null,
  depth: number,
  parentHandle: string | null,
  order: ReplyOrder,
): Promise<LoadedReplies> {
  if (!uuid.test(id) || (cursor !== null && (typeof cursor !== 'string' || cursor.length > 500)) ||
    (order !== 'newest' && order !== 'oldest') ||
    !Number.isInteger(depth) || depth < 1 || depth > 6 ||
    (parentHandle !== null && (typeof parentHandle !== 'string' || parentHandle.length > 100))) {
    return { error: 'These replies could not be loaded. Open the conversation and try again.' }
  }
  try {
    const [page, viewer] = await Promise.all([getReplies(id, cursor ?? undefined, order), getViewer()])
    if (!page) return { error: 'These replies are no longer available.' }
    const viewerId = viewer.state === 'member' ? viewer.me.id : null
    const now = Date.now()
    return { rows: page.replies.map((post) => renderThreadRow(post, viewerId, now, depth, parentHandle)), cursor: page.cursor }
  } catch {
    return { error: 'Replies could not be loaded. Check your connection and try again.' }
  }
}

/** Reply success adds one confirmed row, without re-rendering the route or its branches. */
export async function createThreadReply(previous: ComposeState, formData: FormData): Promise<ComposeState> {
  const parentId = String(formData.get('replyTo') ?? '')
  const depth = Number(formData.get('threadDepth'))
  if (!uuid.test(parentId) || !Number.isInteger(depth) || depth < 1 || depth > 7) {
    return { error: 'Choose the post you want to reply to and try again.' }
  }
  const result = await createPost(previous, formData, false)
  if (!result.postedAt || !result.postId) return result
  try {
    const [post, viewer] = await Promise.all([getPost(result.postId), getViewer()])
    if (!post || post.replyParentId !== parentId) return result
    const viewerId = viewer.state === 'member' ? viewer.me.id : null
    const parentHandle = String(formData.get('replyHandle') ?? '').slice(0, 100) || null
    return { ...result, reply: { parentId, row: renderThreadRow(post, viewerId, Date.now(), depth, parentHandle) } }
  } catch {
    // The write succeeded. Show its permalink; never invite a duplicate retry of the write.
    return result
  }
}
