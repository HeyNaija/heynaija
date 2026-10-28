import type { IdeaGroup, IdeaKind, IdeaStatus } from './api'

/** How each status is named on the board and on an idea's page. */
export const STATUS_LABELS: Record<IdeaStatus, string> = {
  under_review: 'Under review',
  planned: 'Planned',
  in_progress: 'In progress',
  shipped: 'Shipped',
  not_now: 'Not now',
  duplicate: 'Duplicate',
}

export const KIND_LABELS: Record<IdeaKind, string> = { idea: 'Idea', problem: 'Problem' }

export const GROUP_LABELS: Record<IdeaGroup, string> = { open: 'Open', shipped: 'Shipped', closed: 'Closed' }

/** Only these take new votes. */
export const OPEN_STATUSES: readonly IdeaStatus[] = ['under_review', 'planned', 'in_progress']

/** Longest title, as the API allows. */
export const IDEA_TITLE_MAX = 80

/** "Your idea is now planned", "A problem you voted for is now shipped": a notification's words. */
export function ideaNews(idea: { kind: IdeaKind; yours: boolean }, status: string | null): string {
  const what =
    idea.kind === 'problem'
      ? idea.yours ? 'The problem you reported' : 'A problem you voted for'
      : idea.yours ? 'Your idea' : 'An idea you voted for'
  const label = STATUS_LABELS[status as IdeaStatus]
  return label ? `${what} is now ${label.toLowerCase()}` : `${what} has a new status`
}

export type BoardChoice = { group: IdeaGroup; kind: IdeaKind | 'all'; sort: 'top' | 'new' }

/** The board's address for a choice, leaving out what is the default. */
export function boardHref({ group, kind, sort }: BoardChoice, cursor?: number): string {
  const query = new URLSearchParams()
  if (group !== 'open') query.set('group', group)
  if (kind !== 'all') query.set('kind', kind)
  if (sort !== 'top') query.set('sort', sort)
  if (cursor) query.set('cursor', String(cursor))
  const q = query.toString()
  return q ? `/ideas?${q}` : '/ideas'
}

/** The ID of an idea named by its link (…/p/<id>) or the ID itself; null if there is none. */
export function ideaIdFrom(text: string): string | null {
  return text.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i)?.[0]?.toLowerCase() ?? null
}
