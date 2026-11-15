import { createHash } from 'node:crypto'

// How Trivia judges and scores (docs/games/GAMES.md, docs/adr/0028 phase 7). Pure
// functions, so the rules can be read and tested apart from the database.

/** Points in a round: a right answer, and more for the first three right answers. */
export const TRIVIA_POINTS = {
  right: 10,
  /** First, second and third right answer. */
  order: [5, 3, 2],
} as const

/** The points an answer gets: none if wrong; 10 if right, plus 5, 3 or 2 for the first three. */
export function pointsFor(correct: boolean, place: number | null): number {
  if (!correct) return 0
  return TRIVIA_POINTS.right + (place !== null && place >= 1 && place <= TRIVIA_POINTS.order.length ? TRIVIA_POINTS.order[place - 1]! : 0)
}

/**
 * A typed answer as the matcher compares it: lower case, accents taken off
 * (Gojō reads gojo), a leading "the" dropped, and nothing but letters and digits
 * (so "Shingeki no Kyojin" and "shingeki-no-kyojin" are the same).
 */
export function normalise(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .trim()
    .replace(/^the\s+/, '')
    .replace(/[^\p{L}\p{N}]/gu, '')
}

/** How many single-letter changes (add, drop, swap neighbours, replace) turn `a` into `b`. */
export function editDistance(a: string, b: string): number {
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)))
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      d[i]![j] = Math.min(d[i - 1]![j]! + 1, d[i]![j - 1]! + 1, d[i - 1]![j - 1]! + cost)
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i]![j] = Math.min(d[i]![j]!, d[i - 2]![j - 2]! + 1)
    }
  }
  return d[a.length]![b.length]!
}

/** The typos forgiven in an answer as long as `accepted`: none under 6 letters, one up to 11, two from 12. */
export const typosAllowed = (length: number): number => (length >= 12 ? 2 : length >= 6 ? 1 : 0)

/** Whether a typed answer (already normalised) matches any accepted answer, allowing for small typos. */
export function matches(normalised: string, accepted: string[]): boolean {
  if (!normalised) return false
  return accepted.some((a) => {
    const target = normalise(a)
    if (!target) return false
    if (target === normalised) return true
    const allowed = typosAllowed(target.length)
    return allowed > 0 && Math.abs(target.length - normalised.length) <= allowed && editDistance(normalised, target) <= allowed
  })
}

/**
 * The order a member sees a question's choices in: shuffled for each member, the
 * same every time they look, so "it's the second one" is no help to anyone else.
 * Returns the choices' indexes in the order to show them.
 */
export function choiceOrder(questionId: string, memberId: string, count: number): number[] {
  const order = Array.from({ length: count }, (_, i) => i)
  const bytes = createHash('sha256').update(`${questionId}:${memberId}`).digest()
  for (let i = count - 1; i > 0; i--) {
    const j = bytes[i]! % (i + 1)
    ;[order[i], order[j]] = [order[j]!, order[i]!]
  }
  return order
}

export type JudgedAnswer = { memberId: string; correct: boolean; answeredAt: Date; seq: number }

/** Each right answer's place among the right answers: the earliest first, written order breaking an exact tie. */
export function placesOf(answers: JudgedAnswer[]): Map<string, number> {
  const right = answers.filter((a) => a.correct).sort((x, y) => x.answeredAt.getTime() - y.answeredAt.getTime() || x.seq - y.seq)
  return new Map(right.map((a, i) => [a.memberId, i + 1]))
}

export type RoundTotal = { memberId: string; points: number; timeMs: number }

/**
 * A round's places: most points first; on equal points the less time spent on
 * right answers; still level, a shared place.
 */
export function roundPlaces(totals: RoundTotal[]): Map<string, number> {
  const sorted = [...totals].sort((a, b) => b.points - a.points || a.timeMs - b.timeMs)
  const places = new Map<string, number>()
  sorted.forEach((t, i) => {
    const before = sorted[i - 1]
    places.set(t.memberId, i > 0 && before!.points === t.points && before!.timeMs === t.timeMs ? places.get(before!.memberId)! : i + 1)
  })
  return places
}
