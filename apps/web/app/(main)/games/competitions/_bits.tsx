import Link from 'next/link'
import { LocalTime } from '@/app/ui/local-time'
import type { CompetitionCard } from '@/lib/api'

export const STATUS: Record<CompetitionCard['status'], string> = {
  draft: 'Draft',
  open: 'Coming up',
  live: 'Live',
  finished: 'Finished',
  cancelled: 'Cancelled',
}

export const ELIGIBILITY: Record<CompetitionCard['eligibility'], string> = {
  open: 'Open to everyone with Games',
  community: 'For members of a community',
  invite: 'By invitation',
}

/** What is played, in a word or two: "Keno", "Chess · Arena". */
export const gameLabel = (c: Pick<CompetitionCard, 'game' | 'format'>): string =>
  c.format === 'lichess_arena' ? 'Chess · Arena' : c.format === 'lichess_swiss' ? 'Chess · Swiss' : c.game === 'keno' ? 'Keno' : c.game

/** A clock as Lichess writes it: 3+2 (minutes and seconds added a move). */
export const clockLabel = (clock: { limit: number; increment: number }): string => `${clock.limit / 60}+${clock.increment}`

/** A score as a competition counts it: Swiss points are kept doubled, so 9 reads "4½". */
export function scoreLabel(format: string, score: number): string {
  if (format !== 'lichess_swiss') return `${score.toLocaleString('en-NG')} pts`
  const whole = Math.floor(score / 2)
  return `${score % 2 ? `${whole || ''}½` : whole} pts`
}

/** When it runs, in the reader's time. */
export function When({ c }: { c: Pick<CompetitionCard, 'startsAt' | 'endsAt'> }) {
  return (
    <>
      <LocalTime at={c.startsAt} as="posted" /> to <LocalTime at={c.endsAt} as="posted" />
    </>
  )
}

/** A Lagos datetime-local value ("2026-11-08T18:00") for an instant. */
export const lagosInput = (iso: string | Date): string => new Date(new Date(iso).getTime() + 3_600_000).toISOString().slice(0, 16)

/** A list of competitions, each with its state, when and how many entered. */
export function CompetitionSection({ title, items }: { title: string; items: CompetitionCard[] }) {
  return (
    <section className="content-panel" aria-label={title}>
      <h2 className="section-title">{title}</h2>
      <ul className="keno-tickets">
        {items.map((c) => (
          <li key={c.id}>
            <span className="flex flex-wrap items-center gap-2">
              <Link href={`/games/competitions/${c.id}`} className="font-semibold hover:underline">{c.name}</Link>
              <span className="chip">{STATUS[c.status]}</span>
            </span>
            <span className="text-sm text-muted">
              {gameLabel(c)} · <When c={c} /> · {c.entrants} {c.entrants === 1 ? (c.game === 'chess' ? 'member playing' : 'entrant') : c.game === 'chess' ? 'members playing' : 'entrants'}
            </span>
          </li>
        ))}
      </ul>
    </section>
  )
}
