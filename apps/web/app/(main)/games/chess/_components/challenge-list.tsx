import Link from 'next/link'
import { Avatar } from '@/app/ui/avatar'
import { LocalTime } from '@/app/ui/local-time'
import { SubmitButton } from '@/app/ui/submit-button'
import type { ChessChallenge } from '@/lib/api'
import { answerChallenge } from '../actions'

const SPEED_NAMES = { blitz: 'Blitz', rapid: 'Rapid', classical: 'Classical', correspondence: 'Correspondence' } as const
const COLOR_WORDS = { random: 'either colour', white: 'white', black: 'black' } as const
const STATUS_WORDS: Record<ChessChallenge['status'], string> = {
  pending: 'Waiting',
  accepted: 'Accepted',
  declined: 'Declined',
  cancelled: 'Cancelled',
  failed: 'Could not be made',
  expired: 'Expired',
}

/** One challenge, from the viewer's side: who, what game, and what they can do about it. */
function ChallengeRow({ challenge: c, now }: { challenge: ChessChallenge; now: number }) {
  const who = c.opponent.displayName ?? `@${c.opponent.handle}`
  const game = `${c.rated ? 'Rated' : 'Casual'} ${SPEED_NAMES[c.speed]} ${c.time}, you play ${COLOR_WORDS[c.color]}`
  return (
    <li id={`challenge-${c.id}`} className="chess-challenge">
      <div className="flex items-start gap-3">
        <Link href={`/u/${c.opponent.handle}`} aria-hidden="true" tabIndex={-1}>
          <Avatar handle={c.opponent.handle} src={c.opponent.avatar} size={36} />
        </Link>
        <div className="min-w-0 flex-1">
          <p className="break-words text-sm leading-6">
            {c.sent ? 'You challenged ' : ''}
            <Link href={`/u/${c.opponent.handle}`} className="font-semibold hover:underline">
              {who}
            </Link>
            {c.sent ? '' : ' challenged you'}
          </p>
          <p className="text-[13px] text-muted">{game}</p>
          <p className="mt-0.5 text-xs text-muted">
            {c.status === 'pending' ? (
              <>
                Open until <LocalTime at={c.expiresAt} as="posted" />
              </>
            ) : (
              <>
                {STATUS_WORDS[c.status]} · <LocalTime at={c.createdAt} now={now} />
              </>
            )}
          </p>
        </div>
      </div>
      {c.status === 'pending' ? (
        <form action={answerChallenge} className="chess-challenge-actions">
          <input type="hidden" name="id" value={c.id} />
          {c.sent ? (
            <SubmitButton name="action" value="cancel" className="btn btn-secondary btn-sm">
              Cancel
            </SubmitButton>
          ) : (
            <>
              <SubmitButton name="action" value="accept" className="btn btn-primary btn-sm">
                Accept
              </SubmitButton>
              <SubmitButton name="action" value="decline" className="btn btn-ghost btn-sm">
                Decline
              </SubmitButton>
            </>
          )}
        </form>
      ) : c.gameUrl ? (
        <div className="chess-challenge-actions">
          <a href={c.gameUrl} target="_blank" rel="noopener noreferrer" className="btn btn-primary btn-sm">
            Open on lichess.org
          </a>
        </div>
      ) : null}
    </li>
  )
}

export function ChallengeList({ challenges, now }: { challenges: ChessChallenge[]; now: number }) {
  return (
    <ul className="chess-challenges">
      {challenges.map((c) => (
        <ChallengeRow key={c.id} challenge={c} now={now} />
      ))}
    </ul>
  )
}
