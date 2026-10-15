import type { ReactNode } from 'react'

/** Server-rendered rows travel through the action without shipping PostItem as client code. */
export type ThreadRow = { id: string; node: ReactNode }
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
export const THREAD_MAX_DEPTH = 6

/** Scope cycle detection to the rendered ancestry, never to unrelated branches. */
export function nextThreadPath(ancestors: readonly string[], id: string): readonly string[] | null {
  return ancestors.includes(id) ? null : [...ancestors, id]
}

export function canRenderThreadChildren(depth: number, pathLength: number): boolean {
  return depth < THREAD_MAX_DEPTH && pathLength <= THREAD_MAX_DEPTH
}

export function emptyBranch(parentId: string | null): BranchState {
  return { parentId, items: [], recent: [], cursor: null, loaded: false, open: false, status: 'idle', touched: 0 }
}

function uniqueRows(rows: ThreadRow[]) {
  const seen = new Set<string>()
  return rows.filter((row) => !seen.has(row.id) && !!seen.add(row.id))
}

/** A confirmed write never becomes a pagination cursor or disguises an unloaded gap. */
export function insertConfirmedReply(branch: BranchState, row: ThreadRow): BranchState {
  if (branch.items.some((item) => item.id === row.id) || branch.recent.some((item) => item.id === row.id)) return branch
  return branch.loaded && branch.cursor === null
    ? { ...branch, open: true, items: [...branch.items, row] }
    : { ...branch, open: true, recent: [...branch.recent, row] }
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
