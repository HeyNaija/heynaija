import Link from 'next/link'
import { getChessMember } from '@/lib/api'

const SHOWN = [
  ['blitz', 'Blitz'],
  ['rapid', 'Rapid'],
  ['classical', 'Classical'],
  ['correspondence', 'Correspondence'],
] as const

/**
 * A member's Lichess account on their profile (docs/adr/0028): the username, the
 * ratings they have, and a way to challenge them. Nothing at all when they have
 * not connected one, or the viewer cannot see them.
 */
export async function LichessLine({ handle }: { handle: string }) {
  const account = await getChessMember(handle).catch(() => null)
  if (!account) return null
  const ratings = SHOWN.filter(([speed]) => account.ratings[speed]).map(([speed, name]) => `${name} ${account.ratings[speed]!.rating}`)
  return (
    <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
      <span>
        Lichess{' '}
        <a href={account.url} target="_blank" rel="noopener noreferrer" className="font-semibold text-accent-strong hover:underline">
          {account.username}
        </a>
      </span>
      {ratings.map((r) => (
        <span key={r}>· {r}</span>
      ))}
      {account.playing ? (
        <Link href={`/games/chess/games/${account.playing.id}`} className="font-semibold text-accent-strong hover:underline">
          · Playing now: watch
        </Link>
      ) : null}
      {account.canChallenge ? (
        <Link href={`/games/chess?opponent=${encodeURIComponent(handle)}#chess-challenge`} className="font-semibold text-accent-strong hover:underline">
          · Challenge to chess
        </Link>
      ) : null}
    </p>
  )
}
