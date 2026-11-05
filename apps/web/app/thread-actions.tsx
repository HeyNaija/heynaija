'use server'

import { redirect } from 'next/navigation'
import { api, getGistReplies, getGistReply, getGistReplyBranch, getPost, getReplies, getViewer } from '@/lib/api'
import { POST_MAX } from '@/lib/post-length'
import { createPost, type ComposeState } from '@/app/actions'
import { renderThreadRow } from '@/app/ui/thread-row'
import { type ReplyOrder, type ThreadRow, THREAD_MAX_DEPTH, THREAD_MAX_GAPS } from '@/lib/thread-state'

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
    !Number.isInteger(depth) || depth < 1 || depth > THREAD_MAX_DEPTH + THREAD_MAX_GAPS ||
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
  if (!uuid.test(parentId) || !Number.isInteger(depth) || depth < 1 || depth > THREAD_MAX_DEPTH) {
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

/** One page of a Gist's comment section: its top level (`parentId` null) or the replies under one reply. */
export async function loadGistReplies(
  gistId: string,
  parentId: string | null,
  cursor: string | null,
  depth: number,
  parentHandle: string | null,
  order: ReplyOrder,
): Promise<LoadedReplies> {
  if (!uuid.test(gistId) || (parentId !== null && !uuid.test(parentId)) ||
    (cursor !== null && (typeof cursor !== 'string' || cursor.length > 500)) ||
    (order !== 'newest' && order !== 'oldest') ||
    !Number.isInteger(depth) || depth < 1 || depth > THREAD_MAX_DEPTH + THREAD_MAX_GAPS ||
    (parentHandle !== null && (typeof parentHandle !== 'string' || parentHandle.length > 100))) {
    return { error: 'These replies could not be loaded. Reload the Gist and try again.' }
  }
  try {
    const [page, viewer] = await Promise.all([
      parentId ? getGistReplyBranch(gistId, parentId, cursor ?? undefined, order) : getGistReplies(gistId, cursor ?? undefined, order),
      getViewer(),
    ])
    if (!page) return { error: 'These replies are no longer available.' }
    const viewerId = viewer.state === 'member' ? viewer.me.id : null
    const gist = { id: gistId, viewerIsHost: 'viewerIsHost' in page && page.viewerIsHost === true }
    const now = Date.now()
    return { rows: page.replies.map((post) => renderThreadRow(post, viewerId, now, depth, parentHandle, false, gist)), cursor: page.cursor }
  } catch {
    return { error: 'Replies could not be loaded. Check your connection and try again.' }
  }
}

/** Writes a reply in a Gist: at the top when `replyTo` is the Gist itself, else under that reply. */
export async function createGistReply(gistId: string, _previous: ComposeState, formData: FormData): Promise<ComposeState> {
  const target = String(formData.get('replyTo') ?? '')
  const depth = Number(formData.get('threadDepth'))
  const text = String(formData.get('text') ?? '')
  if (!uuid.test(gistId) || !uuid.test(target) || !Number.isInteger(depth) || depth < 1 || depth > THREAD_MAX_DEPTH) {
    return { error: 'Choose the post you want to reply to and try again.' }
  }
  const replyTo = target === gistId ? undefined : target
  const res = await api(`/v1/gists/${encodeURIComponent(gistId)}/replies`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text, replyTo }),
  }).catch(() => null)
  if (!res) return { error: 'Could not post. Check your connection and try again.' }
  if (res.status === 401) redirect('/login')
  if (res.status === 429) return { error: 'You are posting very fast. Wait a minute and try again.' }
  if (res.status === 403) return { error: 'The host has limited who can reply.' }
  if (res.status === 404) return { error: 'This reply or Gist is no longer available.' }
  if (res.status === 400) {
    return { error: text.trim() ? `That reply is too long. The limit is ${POST_MAX.toLocaleString('en-NG')} characters.` : 'Write something first.' }
  }
  if (!res.ok) return { error: 'Could not post. Check your connection and try again.' }
  const { id } = (await res.json()) as { id: string }
  const result: ComposeState = { postedAt: Date.now(), postId: id }
  try {
    const [post, viewer] = await Promise.all([getGistReply(gistId, id), getViewer()])
    if (!post) return result
    const viewerId = viewer.state === 'member' ? viewer.me.id : null
    const parentHandle = String(formData.get('replyHandle') ?? '').slice(0, 100) || null
    return { ...result, reply: { parentId: target, row: renderThreadRow(post, viewerId, Date.now(), depth, parentHandle, false, { id: gistId, viewerIsHost: false }) } }
  } catch {
    return result
  }
}
