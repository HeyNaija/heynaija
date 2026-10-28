import type { IDEA_STATUSES } from '@heynaija/db'

/** How a status reads after "is now": "Your idea is now planned". */
export const STATUS_WORDS: Record<(typeof IDEA_STATUSES)[number], string> = {
  under_review: 'under review',
  planned: 'planned',
  in_progress: 'in progress',
  shipped: 'shipped',
  not_now: 'not planned for now',
  duplicate: 'marked as a duplicate',
}

/** "Your idea is now planned", "A problem you voted for is now shipped". */
export function ideaHeadline(idea: { kind: string; yours: boolean }, status: string | null): string {
  const what = idea.kind === 'problem' ? (idea.yours ? 'The problem you reported' : 'A problem you voted for') : idea.yours ? 'Your idea' : 'An idea you voted for'
  const words = STATUS_WORDS[status as keyof typeof STATUS_WORDS] ?? 'changed'
  return `${what} is now ${words}`
}
