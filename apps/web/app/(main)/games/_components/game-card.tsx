import Link from 'next/link'
import { ChessIcon, GamesIcon, KenoIcon } from '@/app/ui/icons'
import type { GameManifest } from '@/lib/api'

const STATUS_LABELS: Record<GameManifest['status'], string> = { live: 'Live', beta: 'Beta', coming_soon: 'Coming soon' }

/**
 * The game's logo: its cover art once approved (a picture under /media or /brand),
 * otherwise its icon in a sage tile. Decorative: the name is printed below it.
 */
function GameLogo({ game }: { game: GameManifest }) {
  if (game.cover) {
    return (
      <span className="game-logo has-photo">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={game.cover} alt="" width={72} height={72} loading="lazy" decoding="async" />
      </span>
    )
  }
  const Icon = game.slug === 'chess' ? ChessIcon : game.slug === 'keno' ? KenoIcon : GamesIcon
  return (
    <span className="game-logo">
      <Icon size={34} />
    </span>
  )
}

/** One game from the registry, as a tile in the games grid; the whole tile opens it once it can be played. */
export function GameCard({ game }: { game: GameManifest }) {
  const body = (
    <>
      <GameLogo game={game} />
      <h3 className="text-[15px] font-semibold">{game.name}</h3>
      <p className="text-sm text-muted">{game.tagline}</p>
      <span className="chip mt-auto">{STATUS_LABELS[game.status]}</span>
    </>
  )
  return (
    <li className="flex">
      {game.status === 'coming_soon' ? (
        <div className="community-card game-tile" aria-disabled="true">{body}</div>
      ) : (
        <Link href={`/games/${game.slug}`} className="community-card game-tile" aria-label={`Play ${game.name}`}>
          {body}
        </Link>
      )}
    </li>
  )
}
