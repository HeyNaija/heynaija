import Link from 'next/link'
import { ChessIcon, GamesIcon, KenoIcon } from '@/app/ui/icons'
import type { GameManifest } from '@/lib/api'

const STATUS_LABELS: Record<GameManifest['status'], string> = { live: 'Live', beta: 'Beta', coming_soon: 'Coming soon' }

/** The game's icon in a sage tile, as communities without photos get, until a game has approved cover art. */
function GameMark({ slug }: { slug: string }) {
  const Icon = slug === 'chess' ? ChessIcon : slug === 'keno' ? KenoIcon : GamesIcon
  return (
    <span className="community-mark is-large">
      <Icon size={26} />
    </span>
  )
}

/** One game from the registry: what it is, where it stands, and Play once it can be played. */
export function GameCard({ game }: { game: GameManifest }) {
  const playable = game.status !== 'coming_soon'
  return (
    <li className="community-card">
      <div className="flex items-start gap-3">
        <GameMark slug={game.slug} />
        <div className="min-w-0 flex-1">
          <h3 className="text-[15px] font-semibold">{game.name}</h3>
          <p className="mt-1 text-sm text-muted">{game.tagline}</p>
        </div>
        <span className="chip shrink-0">{STATUS_LABELS[game.status]}</span>
      </div>
      <p className="flex-1 text-sm leading-relaxed text-muted">{game.description}</p>
      <div className="community-card-footer">
        {playable ? (
          <Link href={`/games/${game.slug}`} className="btn btn-primary" aria-label={`Play ${game.name}`}>
            Play
          </Link>
        ) : (
          <span className="text-sm text-muted">Not open yet</span>
        )}
      </div>
    </li>
  )
}
