import { communities, communityMemberships, type Db, members, profileBadges } from '@heynaija/db'
import { Inject, Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common'
import { and, eq, ne } from 'drizzle-orm'
import { DB } from '../../tokens.js'
import { ARBITER_FALLBACK_HANDLE, ARBITER_HANDLE, ARBITER_ID, ARENA_SLUG } from './arena-ids.js'

export const ARBITER_BIO = 'Automated account: posts game threads and results for Chess Arena. Nobody signs in to it.'

const ARENA = {
  slug: ARENA_SLUG,
  name: 'Chess Arena',
  description: 'One thread for every match played on HeyNaija. Watch live and talk about the game; the players see the talk once the game is over.',
  rules: [
    'Threads here are started by The Arbiter, one for each match, when the challenger chooses to open one. Reply in them.',
    'While a game is on, the two players do not see spectators’ replies. That is a courtesy, not anti-cheat: anyone can watch on lichess.org. Do not try to reach the players with advice during a game.',
    'Be kind about other people’s games. HeyNaija’s rules apply here as everywhere.',
  ].join('\n'),
}

/**
 * Makes The Arbiter, Chess Arena and The Arbiter's place as its moderator, if
 * they are not there yet. Safe to run any number of times; every environment gets
 * them this way, without a seed. Never changes anything a person has: if someone
 * already holds `arbiter`, The Arbiter takes `arbiter_hn`.
 */
export async function ensureArena(db: Db, logger?: Pick<Logger, 'warn'>): Promise<void> {
  const [existing] = await db.select({ id: members.id }).from(members).where(eq(members.id, ARBITER_ID))
  if (!existing) {
    const [taken] = await db
      .select({ id: members.id })
      .from(members)
      .where(and(eq(members.handle, ARBITER_HANDLE), ne(members.id, ARBITER_ID)))
    if (taken) logger?.warn(`a member already has @${ARBITER_HANDLE}; The Arbiter is @${ARBITER_FALLBACK_HANDLE}`)
    await db
      .insert(members)
      .values({
        id: ARBITER_ID,
        handle: taken ? ARBITER_FALLBACK_HANDLE : ARBITER_HANDLE,
        displayName: 'The Arbiter',
        bio: ARBITER_BIO,
        onboardedAt: new Date(),
        emailNotifications: false,
      })
      .onConflictDoNothing()
  }
  await db.insert(profileBadges).values({ memberId: ARBITER_ID, kind: 'automated' }).onConflictDoNothing()
  await db.insert(communities).values(ARENA).onConflictDoNothing({ target: communities.slug })
  const [arena] = await db.select({ id: communities.id }).from(communities).where(eq(communities.slug, ARENA_SLUG))
  await db
    .insert(communityMemberships)
    .values({ communityId: arena!.id, memberId: ARBITER_ID, role: 'moderator' })
    .onConflictDoNothing()
}

@Injectable()
export class ArenaSetup implements OnApplicationBootstrap {
  private readonly logger = new Logger('ChessArena')

  constructor(@Inject(DB) private readonly db: Db) {}

  async onApplicationBootstrap() {
    await ensureArena(this.db, this.logger)
  }
}
