import { redirect } from 'next/navigation'
import { Suspense } from 'react'

/** Keno's standings are its page's Leaderboard tab now; old links still land there. */
export default function KenoLeaderboardPage({ searchParams }: PageProps<'/games/keno/leaderboard'>) {
  // Reading the address waits inside Suspense, as every page's request data must for the build to prerender its shell.
  return (
    <Suspense fallback={null}>
      <ToLeaderboardTab searchParams={searchParams} />
    </Suspense>
  )
}

async function ToLeaderboardTab({ searchParams }: Pick<PageProps<'/games/keno/leaderboard'>, 'searchParams'>): Promise<never> {
  const { period } = await searchParams
  redirect(`/games/keno?tab=leaderboard${period === 'all' ? '&period=all' : ''}`)
}
