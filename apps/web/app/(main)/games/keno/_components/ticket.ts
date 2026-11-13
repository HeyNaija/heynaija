import type { KenoTicket } from '@/lib/api'

export const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

/** How a ticket did: "Matched 4 of 6: 5 points", or that it waits for its draw. */
export function ticketResult(t: Pick<KenoTicket, 'numbers' | 'hits' | 'points'>): string {
  if (t.hits === null) return `${plural(t.numbers.length, 'number')}, waiting for the draw`
  return `Matched ${t.hits} of ${t.numbers.length}: ${plural(t.points ?? 0, 'point')}`
}
