import { type Db, gameSeasons } from '@heynaija/db'
import { eq, sql } from 'drizzle-orm'

// Seasons are Lagos calendar months (docs/games/GAMES.md, docs/adr/0028 phase 5).
// Lagos is UTC+1 all year (no summer time), so its days and months are UTC's moved
// by an hour.

const LAGOS_OFFSET_MS = 3_600_000

/** Midnight in Lagos at the start of the day `now` falls on. */
export function lagosDayStart(now: Date): Date {
  const shifted = now.getTime() + LAGOS_OFFSET_MS
  return new Date(shifted - (shifted % 86_400_000) - LAGOS_OFFSET_MS)
}

/** The Lagos calendar month `at` falls in: its season slug ("2026-11") and bounds. */
export function lagosMonth(at: Date): { slug: string; startsAt: Date; endsAt: Date } {
  const shifted = new Date(at.getTime() + LAGOS_OFFSET_MS)
  const y = shifted.getUTCFullYear()
  const m = shifted.getUTCMonth()
  return {
    slug: `${y}-${String(m + 1).padStart(2, '0')}`,
    startsAt: new Date(Date.UTC(y, m, 1) - LAGOS_OFFSET_MS),
    endsAt: new Date(Date.UTC(y, m + 1, 1) - LAGOS_OFFSET_MS),
  }
}

type Queries = Pick<Db, 'execute' | 'select'>

/** The season `at` falls in, made first if it is not there yet. */
export async function ensureSeason(q: Queries, at: Date): Promise<{ id: string; slug: string }> {
  const month = lagosMonth(at)
  await q.execute(sql`
    insert into games.seasons (slug, starts_at, ends_at) values (${month.slug}, ${month.startsAt}, ${month.endsAt})
    on conflict (slug) do nothing`)
  const [season] = await q.select({ id: gameSeasons.id, slug: gameSeasons.slug }).from(gameSeasons).where(eq(gameSeasons.slug, month.slug))
  return season!
}
