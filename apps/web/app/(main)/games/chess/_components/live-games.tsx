'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { Avatar } from '@/app/ui/avatar'
import type { LiveChessGame } from '@/lib/api'

const SPEED_NAMES = { blitz: 'Blitz', rapid: 'Rapid', classical: 'Classical', correspondence: 'Correspondence' } as const
/** As often as Gists' "Live now", and only while the page is in view. */
const REFRESH_MS = 30_000

const name = (p: LiveChessGame['white']) => p.displayName ?? `@${p.handle}`

/** Games being played now (docs/adr/0018), refreshed while the page is visible. */
export function LiveGames({ initial }: { initial: LiveChessGame[] }) {
  const [games, setGames] = useState(initial)

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const load = async () => {
      const res = await fetch('/api/v1/games/chess/games/live', { cache: 'no-store' }).catch(() => null)
      if (res?.ok) setGames(((await res.json()) as { games: LiveChessGame[] }).games)
    }
    const schedule = () => {
      clearTimeout(timer)
      if (document.visibilityState === 'visible') timer = setTimeout(async () => {
        await load()
        schedule()
      }, REFRESH_MS)
    }
    const onVisible = () => {
      if (document.visibilityState === 'visible') void load()
      schedule()
    }
    schedule()
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      clearTimeout(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [])

  if (!games.length) return <p className="mt-2 text-sm text-muted">No games are being played right now.</p>
  return (
    <ul className="chess-challenges">
      {games.map((g) => (
        <li key={g.id} className="chess-challenge">
          <Link href={`/games/chess/games/${g.id}`} className="flex items-center gap-3 hover:underline">
            <span className="flex shrink-0 -space-x-2" aria-hidden="true">
              <Avatar handle={g.white.handle} src={g.white.avatar} size={28} />
              <Avatar handle={g.black.handle} src={g.black.avatar} size={28} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-semibold">
                {name(g.white)} vs {name(g.black)}
              </span>
              <span className="block text-[13px] text-muted">
                {g.rated ? 'Rated' : 'Casual'} {SPEED_NAMES[g.speed]} {g.time} · {g.moveCount ? `${Math.ceil(g.moveCount / 2)} moves in` : 'just started'}
              </span>
            </span>
            <span className="chip shrink-0">Watch</span>
          </Link>
        </li>
      ))}
    </ul>
  )
}
