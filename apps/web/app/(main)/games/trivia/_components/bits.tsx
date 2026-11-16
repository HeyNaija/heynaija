import Link from 'next/link'
import { Avatar } from '@/app/ui/avatar'
import { LocalTime } from '@/app/ui/local-time'
import type { TriviaPerson, TriviaPicture, TriviaRoundCard, TriviaStanding, TriviaStatus } from '@/lib/api'

// Pieces every Trivia page shares (docs/games/GAMES.md, docs/adr/0028 phase 7).

export const TRIVIA_STATUS: Record<TriviaStatus, string> = {
  draft: 'Draft',
  scheduled: 'Coming up',
  live: 'Live',
  reviewing: 'Checking answers',
  published: 'Results out',
  cancelled: 'Called off',
}

export const nameOf = (p: TriviaPerson) => p.displayName ?? `@${p.handle}`

/** "2.41 s" */
export const secondsLabel = (ms: number) => `${(Math.max(0, ms) / 1000).toFixed(2)} s`

/** "1st", "2nd", "3rd", "4th" … */
export function ordinal(n: number): string {
  const tens = n % 100
  if (tens >= 11 && tens <= 13) return `${n}th`
  return `${n}${['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`
}

/** A list of rounds, each with its state, when, its host and how many played. */
export function RoundSection({ title, items, hosting = false }: { title: string; items: TriviaRoundCard[]; hosting?: boolean }) {
  return (
    <section className="content-panel" aria-label={title}>
      <h2 className="section-title">{title}</h2>
      <ul className="keno-tickets">
        {items.map((r) => (
          <li key={r.id}>
            <span className="flex flex-wrap items-center gap-2">
              <Link href={hosting ? `/games/trivia/rounds/${r.id}/host` : `/games/trivia/rounds/${r.id}`} className="font-semibold hover:underline">
                {r.title}
              </Link>
              <span className="chip">{TRIVIA_STATUS[r.status]}</span>
              {r.yourPlace ? <span className="chip">You came {ordinal(r.yourPlace)}</span> : null}
            </span>
            <span className="text-sm text-muted">
              <LocalTime at={r.startsAt} as="posted" /> · {r.questions} {r.questions === 1 ? 'question' : 'questions'}, {r.secondsPerQuestion} s each
              {r.players ? ` · ${r.players} ${r.players === 1 ? 'player' : 'players'}` : ''} · hosted by {nameOf(r.host)}
              {r.community ? ` in ${r.community.name}` : ''}
            </span>
          </li>
        ))}
      </ul>
    </section>
  )
}

/** A round's standings: the top ten, and the viewer below them if they are further down. */
export function Standings({ rows, you, final }: { rows: TriviaStanding[]; you: TriviaStanding | null; final: boolean }) {
  const youShown = rows.some((r) => r.you)
  const line = (r: TriviaStanding) => (
    <li key={r.handle} className="keno-board-row" data-you={r.you || undefined}>
      <span className="keno-rank">{r.rank}</span>
      <Link href={`/u/${r.handle}`} className="flex min-w-0 flex-1 items-center gap-2 hover:underline">
        <Avatar handle={r.handle} src={r.avatar} size={28} />
        <span className="truncate">
          {nameOf(r)}
          {r.you ? <span className="text-muted"> (you)</span> : null}
        </span>
      </Link>
      <span className="keno-points">
        {r.points.toLocaleString('en-NG')} {r.points === 1 ? 'point' : 'points'}
      </span>
    </li>
  )
  return (
    <section className="content-panel" aria-labelledby="trivia-standings">
      <h2 id="trivia-standings" className="section-title">{final ? 'Results' : 'Standings so far'}</h2>
      {rows.length ? (
        <ol className="keno-board">
          {rows.map(line)}
          {you && !youShown ? (
            <>
              <li className="keno-board-gap" aria-hidden="true">…</li>
              {line(you)}
            </>
          ) : null}
        </ol>
      ) : (
        <p className="mt-2 text-sm text-muted">Nobody has scored yet. Points appear here as each question closes.</p>
      )}
      {!final && rows.length ? <p className="mt-2 text-xs text-muted">Places are final once the host publishes the results.</p> : null}
    </section>
  )
}

/**
 * A question's picture. While the question is open it is the 640 version only, so a
 * phone on a slow connection is not also fetching a large file against the clock;
 * afterwards, the larger one on screens that want it.
 */
export function QuestionPicture({ picture, live = false }: { picture: TriviaPicture; live?: boolean }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element -- already resized to the sizes we need
    <img
      className="trivia-picture"
      src={`${picture.src}/640.webp`}
      srcSet={live ? undefined : `${picture.src}/640.webp 640w, ${picture.src}/1600.webp 1600w`}
      sizes={live ? undefined : '(min-width: 720px) 640px, 100vw'}
      alt={picture.alt}
      width={picture.width ?? undefined}
      height={picture.height ?? undefined}
      loading={live ? 'eager' : 'lazy'}
      fetchPriority={live ? 'high' : undefined}
      decoding="async"
    />
  )
}
