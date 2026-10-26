import type { ReactNode } from 'react'

/**
 * Server-rendered rows travel through the action without shipping PostItem as client code.
 * `lead` marks a reply by the author of the post it answers; those come first.
 */
export type ThreadRow = { id: string; node: ReactNode; lead?: boolean }
/** Each group of replies (the author's, then everyone else's) in time order: newest or oldest first. */
export type ReplyOrder = 'newest' | 'oldest'
export type ReplyTarget = { id: string; parentId: string | null; handle: string; depth: number }
export type BranchState = {
  parentId: string | null
  items: ThreadRow[]
  recent: ThreadRow[]
  cursor: string | null
  loaded: boolean
  open: boolean
  status: 'idle' | 'loading' | 'error'
  error?: string
  touched: number
}
export type BranchCache = Record<string, BranchState>
/**
 * Replies opened in place stop here, counting from the post in focus: its replies are
 * level 1. A reply at the limit has no replies drawn under it; "Continue conversation"
 * opens it as the focus instead. More levels only narrow the column on a phone.
 */
export const THREAD_MAX_DEPTH = 3
/**
 * A post that is gone has no page to continue to, so one at the limit would strand
 * the replies behind it. These may open a few levels further, the way they always
 * could, but not without end: a malformed chain must not grow forever.
 */
export const THREAD_MAX_GAPS = 6

/** Scope cycle detection to the rendered ancestry, never to unrelated branches. */
export function nextThreadPath(ancestors: readonly string[], id: string): readonly string[] | null {
  return ancestors.includes(id) ? null : [...ancestors, id]
}

export function canRenderThreadChildren(depth: number, pathLength: number, unavailable = false): boolean {
  const limit = unavailable ? THREAD_MAX_DEPTH + THREAD_MAX_GAPS : THREAD_MAX_DEPTH
  return depth < limit && pathLength <= limit
}

export function emptyBranch(parentId: string | null): BranchState {
  return { parentId, items: [], recent: [], cursor: null, loaded: false, open: false, status: 'idle', touched: 0 }
}

function uniqueRows(rows: ThreadRow[]) {
  const seen = new Set<string>()
  return rows.filter((row) => !seen.has(row.id) && !!seen.add(row.id))
}

/**
 * Where a just-posted reply belongs among the loaded rows, or null while rows
 * not loaded yet could still come before it. It is the newest in its group.
 */
function confirmedPlace(branch: BranchState, row: ThreadRow, order: ReplyOrder): number | null {
  if (!branch.loaded) return null
  const complete = branch.cursor === null
  const firstOther = branch.items.findIndex((item) => !item.lead)
  // Every one of the author's replies is loaded once anyone else's is, or the list is complete.
  const leadEnd = firstOther !== -1 ? firstOther : complete ? branch.items.length : null
  if (order === 'newest') return row.lead ? 0 : leadEnd
  return row.lead ? leadEnd : complete ? branch.items.length : null
}

/** A confirmed write never becomes a pagination cursor or disguises an unloaded gap. */
export function insertConfirmedReply(branch: BranchState, row: ThreadRow, order: ReplyOrder): BranchState {
  if (branch.items.some((item) => item.id === row.id) || branch.recent.some((item) => item.id === row.id)) return branch
  const at = confirmedPlace(branch, row, order)
  return at === null
    ? { ...branch, open: true, recent: [...branch.recent, row] }
    : { ...branch, open: true, items: [...branch.items.slice(0, at), row, ...branch.items.slice(at)] }
}

export function appendReplyPage(branch: BranchState, rows: ThreadRow[], cursor: string | null): BranchState {
  const items = uniqueRows([...branch.items, ...rows])
  const ids = new Set(items.map((row) => row.id))
  const recent = branch.recent.filter((row) => !ids.has(row.id))
  return {
    ...branch,
    items: cursor === null ? uniqueRows([...items, ...recent]) : items,
    recent: cursor === null ? [] : recent,
    cursor,
    loaded: true,
    status: 'idle',
  }
}

function ancestors(id: string | null, cache: BranchCache) {
  const chain = new Set<string>()
  while (id && !chain.has(id)) {
    chain.add(id)
    id = cache[id]?.parentId ?? null
  }
  return chain
}

/** Bound retained collapsed data. Active branches and the editor's ancestry are never evicted. */
export function pruneCollapsedBranches(cache: BranchCache, rootId: string, target: ReplyTarget | null, limit = 200): BranchCache {
  const protectedIds = ancestors(target?.parentId ?? null, cache)
  if (target) protectedIds.add(target.id)
  protectedIds.add(rootId)
  const inactive = (id: string) => [...ancestors(id, cache)].some((parent) => !cache[parent]?.open)
  const candidates = Object.keys(cache)
    .filter((id) => !protectedIds.has(id) && inactive(id))
    .sort((a, b) => cache[a].touched - cache[b].touched)
  let retained = candidates.reduce((count, id) => count + cache[id].items.length + cache[id].recent.length, 0)
  if (retained <= limit) return cache
  const result = { ...cache }
  for (const id of candidates) {
    if (retained <= limit) break
    if (!result[id]) continue
    for (const child of candidates) {
      if (result[child] && ancestors(child, cache).has(id)) {
        retained -= result[child].items.length + result[child].recent.length
        delete result[child]
      }
    }
  }
  return result
}
