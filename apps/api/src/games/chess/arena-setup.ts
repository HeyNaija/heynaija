import { communities, communityMemberships, type Db, members, profileBadges } from '@heynaija/db'
import { Inject, Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common'
import { and, eq, ne } from 'drizzle-orm'
import { DB } from '../../tokens.js'
import { ARBITER_FALLBACK_HANDLE, ARBITER_HANDLE, ARBITER_ID, ARENA_SLUG, GAME_NIGHT_SLUG } from './arena-ids.js'

export const ARBITER_BIO = 'Automated account: posts game threads and results for HeyNaija Games. Nobody signs in to it.'

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

const GAME_NIGHT = {
  slug: GAME_NIGHT_SLUG,
  name: 'Game Night',
  description: 'Competition results from HeyNaija Games. Look back, cheer on, and reply.',
  rules: [
    'Posts here are started by The Arbiter, one for each competition when it ends. Reply in them.',
    'Congratulate, tease kindly, talk tactics. HeyNaija’s rules apply here as everywhere.',
  ].join('\n'),
}

/**
 * Makes The Arbiter, Chess Arena, Game Night and The Arbiter's place as their moderator, if
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
  // An older Arbiter keeps its bio in step with what it now does.
  await db.update(members).set({ bio: ARBITER_BIO }).where(eq(members.id, ARBITER_ID))
  for (const community of [ARENA, GAME_NIGHT]) {
    await db.insert(communities).values(community).onConflictDoNothing({ target: communities.slug })
    const [made] = await db.select({ id: communities.id }).from(communities).where(eq(communities.slug, community.slug))
    await db
      .insert(communityMemberships)
      .values({ communityId: made!.id, memberId: ARBITER_ID, role: 'moderator' })
      .onConflictDoNothing()
  }
}

@Injectable()
export class ArenaSetup implements OnApplicationBootstrap {
  private readonly logger = new Logger('ChessArena')

  constructor(@Inject(DB) private readonly db: Db) {}

  async onApplicationBootstrap() {
    await ensureArena(this.db, this.logger)
  }
}
