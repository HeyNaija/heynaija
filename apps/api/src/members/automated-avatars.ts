import { type Db, media, members } from '@heynaija/db'
import { Inject, Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common'
import { and, eq, or, isNull, inArray } from 'drizzle-orm'
import sharp from 'sharp'
import { ARBITER_ID } from '../games/chess/arena-ids.js'
import { ensureKeke } from '../keke/keke-setup.js'
import { KEKE_ID } from '../keke/keke-ids.js'
import { AVATAR_SIZES, OBJECT_STORE } from '../media/media.service.js'
import type { ObjectStore } from '../media/object-store.js'
import { DB } from '../tokens.js'

// The brand's greens (apps/web/DESIGN.md): white art on one of them, no gradients.
const GREEN = '#258153'
const DEEP = '#176541'
const WHITE = '#ffffff'

const square = (background: string, art: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" fill="${background}"/>${art}</svg>`

/** Keke: a keke (the tricycle taxi) from the front, on HeyNaija green. */
const KEKE_ART = square(
  GREEN,
  `<rect x="20" y="62" width="9" height="19" rx="3" fill="${WHITE}"/>
  <rect x="71" y="62" width="9" height="19" rx="3" fill="${WHITE}"/>
  <rect x="17" y="18" width="66" height="12" rx="6" fill="${WHITE}"/>
  <path d="M25 30 H75 L71 55 H29 Z" fill="${WHITE}"/>
  <path d="M30.5 33.5 H69.5 L66.5 51 H33.5 Z" fill="${GREEN}"/>
  <path d="M27 55 H73 C73 62 66 68 60 72 L57 75 H43 L40 72 C34 68 27 62 27 55 Z" fill="${WHITE}"/>
  <circle cx="50" cy="62.5" r="4.6" fill="${GREEN}"/>
  <rect x="44.5" y="73" width="11" height="12" rx="3.5" fill="${WHITE}"/>
  <rect x="15" y="34" width="8" height="5" rx="2.5" fill="${WHITE}"/>
  <rect x="77" y="34" width="8" height="5" rx="2.5" fill="${WHITE}"/>`,
)

/** The Arbiter: scales, the one who settles results, on deep green. */
const ARBITER_ART = square(
  DEEP,
  `<path d="M50 22 V78 M34 78 H66 M28 32 H72 M28 32 L19 52 C19 57 37 57 37 52 L28 32 M72 32 L63 52 C63 57 81 57 81 52 L72 32" fill="none" stroke="${WHITE}" stroke-width="4.5" stroke-linecap="round" stroke-linejoin="round"/>`,
)

/**
 * HeyNaija's automated accounts' profile photos (the owner's choice, 15 November
 * 2026). Each has a fixed media ID: to change a picture, give it a new ID (and
 * list the old one in `replaces`), so no cached copy of the old one is served
 * under the new address.
 */
export const AUTOMATED_AVATARS = [
  { memberId: KEKE_ID, mediaId: 'ce4e0000-0000-4000-8000-0000000000a1', svg: KEKE_ART, replaces: [] as string[] },
  { memberId: ARBITER_ID, mediaId: 'a7b17e70-0000-4000-8000-0000000000a1', svg: ARBITER_ART, replaces: [] as string[] },
] as const

/**
 * Gives each automated account its picture, made the way an uploaded one is:
 * square WebP files at the avatar sizes in the media bucket, a ready media row,
 * and the member pointing at it. So the web, the apps and notifications show it
 * with nothing of their own. Safe to run at every start: an account that already
 * has its picture is left alone, and one whose picture a moderator removed gets
 * it back only if it has none. An account that does not exist yet is skipped.
 */
export async function ensureAutomatedAvatars(db: Db, store: Pick<ObjectStore, 'write'>, logger?: Pick<Logger, 'log'>): Promise<void> {
  for (const avatar of AUTOMATED_AVATARS) {
    const [member] = await db.select({ avatarMediaId: members.avatarMediaId }).from(members).where(eq(members.id, avatar.memberId))
    if (!member || member.avatarMediaId === avatar.mediaId) continue
    if (member.avatarMediaId && !(avatar.replaces as readonly string[]).includes(member.avatarMediaId)) continue

    const files = await Promise.all(
      AVATAR_SIZES.map(async (px) => ({ px, body: await sharp(Buffer.from(avatar.svg)).resize(px, px).webp({ quality: 90 }).toBuffer() })),
    )
    for (const file of files) await store.write('media', `avatars/${avatar.mediaId}/${file.px}.webp`, file.body, 'image/webp')
    const largest = files.at(-1)!
    await db.transaction(async (tx) => {
      await tx
        .insert(media)
        .values({ id: avatar.mediaId, ownerId: avatar.memberId, kind: 'avatar', status: 'ready', contentType: 'image/webp', bytes: largest.body.length, width: largest.px, height: largest.px, readyAt: new Date() })
        .onConflictDoNothing()
      await tx
        .update(members)
        .set({ avatarMediaId: avatar.mediaId })
        .where(
          and(
            eq(members.id, avatar.memberId),
            avatar.replaces.length ? or(isNull(members.avatarMediaId), inArray(members.avatarMediaId, [...avatar.replaces])) : isNull(members.avatarMediaId),
          ),
        )
    })
    logger?.log(`gave ${avatar.memberId} its profile photo`)
  }
}

/**
 * At start-up, after the modules beneath this one have run theirs (The Arbiter is
 * made by Games): Keke's account, then both accounts' pictures, in that order.
 */
@Injectable()
export class AutomatedAccountsSetup implements OnApplicationBootstrap {
  private readonly logger = new Logger('AutomatedAccounts')

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(OBJECT_STORE) private readonly store: ObjectStore,
  ) {}

  async onApplicationBootstrap() {
    await ensureKeke(this.db, this.logger)
    await ensureAutomatedAvatars(this.db, this.store, this.logger).catch((err: Error) => this.logger.warn(`could not set the automated accounts' photos: ${err.message}`))
  }
}
