import { redirect } from 'next/navigation'
import type { Viewer } from '@/lib/api'

type Member = Extract<Viewer, { state: 'member' }>

/**
 * A Games page's own check, after proxy.ts has let the request through, for when
 * the viewer changed in between (their session ended, or Games closed to them). The
 * same rule as there (docs/deployment/app-links.md): signed out, sign in and come
 * back to `here`; Games not open to them, say so. Never "page not found".
 */
export function requireGames(viewer: Viewer, here: string): asserts viewer is Member {
  if (viewer.state === 'anonymous') redirect(`/games-sign-in?${new URLSearchParams({ to: here })}`)
  if (viewer.state !== 'member' || !viewer.me.features.games) redirect('/games-not-open')
}
