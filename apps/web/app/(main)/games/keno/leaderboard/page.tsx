import { redirect } from 'next/navigation'

/** Keno's standings are its page's Leaderboard tab now; old links still land there. */
export default async function KenoLeaderboardPage({ searchParams }: PageProps<'/games/keno/leaderboard'>) {
  const { period } = await searchParams
  redirect(`/games/keno?tab=leaderboard${period === 'all' ? '&period=all' : ''}`)
}
