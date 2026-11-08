import { notFound } from 'next/navigation'
import { EmptyState } from '@/app/ui/empty-state'
import { TrophyIcon } from '@/app/ui/icons'
import { type GameBoardFilter, type GameBoardKind, getCommunities, getGameBoard, getGameSeasons } from '@/lib/api'
import { BOARD_NAMES, BoardRows, periodName } from './board'

type Params = Record<string, string | string[] | undefined>

const one = (v: string | string[] | undefined) => (typeof v === 'string' ? v : undefined)

/**
 * One board's season or all-time standings, with its season and who-is-on-it choices
 * (docs/adr/0018, phase 5). `path` and `fixed` are where the choices go back to: the
 * Game Score page, or a game's Leaderboard tab.
 */
export async function BoardView({ board, params, path, fixed = {} }: { board: GameBoardKind; params: Params; path: string; fixed?: Record<string, string> }) {
  const filter: GameBoardFilter = one(params.filter) === 'following' ? 'following' : one(params.filter) === 'community' ? 'community' : 'everyone'
  const [seasons, communities] = await Promise.all([getGameSeasons(), getCommunities()])
  if (!seasons) notFound()
  const joined = communities.filter((c) => c.viewerIsMember)
  const community = filter === 'community' ? (one(params.community) ?? joined[0]?.slug) : undefined
  const periodParam = one(params.period)
  const period = periodParam === 'all' || (periodParam && seasons.seasons.includes(periodParam)) ? periodParam : seasons.current
  const data = await getGameBoard({ board, period, filter, community })
  if (!data) notFound()
  const periods = [...new Set([seasons.current, ...seasons.seasons])]
  return (
    <section className="content-panel" aria-labelledby="board-title">
      <form method="get" action={path} className="leaderboard-controls">
        {Object.entries(fixed).map(([k, v]) => (
          <input key={k} type="hidden" name={k} value={v} />
        ))}
        <label className="flex flex-col gap-1.5">
          <span className="field-label">Season</span>
          <select name="period" className="field" defaultValue={period}>
            {periods.map((p) => (
              <option key={p} value={p}>
                {periodName(p)}
                {p === seasons.current ? ' (now)' : ''}
              </option>
            ))}
            <option value="all">All time</option>
          </select>
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="field-label">Who</span>
          <select name="filter" className="field" defaultValue={filter}>
            <option value="everyone">Everyone</option>
            <option value="following">People you follow</option>
            {joined.length ? <option value="community">A community you joined</option> : null}
          </select>
        </label>
        {filter === 'community' && joined.length ? (
          <label className="flex flex-col gap-1.5">
            <span className="field-label">Community</span>
            <select name="community" className="field" defaultValue={community}>
              {joined.map((c) => (
                <option key={c.slug} value={c.slug}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <button type="submit" className="btn btn-secondary self-end">Show</button>
      </form>
      <h2 id="board-title" className="mt-3 text-sm font-semibold">
        {BOARD_NAMES[board]} · {periodName(data.period)}
        {filter === 'following' ? ' · people you follow' : filter === 'community' && community ? ` · ${joined.find((c) => c.slug === community)?.name ?? community}` : ''}
      </h2>
      {data.rows.length ? (
        <BoardRows board={data} />
      ) : (
        <EmptyState icon={<TrophyIcon size={28} />} title="No standings yet">
          Nobody here has scored {data.period === 'all' ? 'yet' : 'this season yet'}. Play a game and the standings start with you.
        </EmptyState>
      )}
    </section>
  )
}
