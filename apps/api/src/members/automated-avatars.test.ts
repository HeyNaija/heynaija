import assert from 'node:assert/strict'
import { after, before, beforeEach, test } from 'node:test'
import { media, members } from '@heynaija/db'
import { eq, inArray } from 'drizzle-orm'
import sharp from 'sharp'
import { ARBITER_ID } from '../games/chess/arena-ids.js'
import { ensureArena } from '../games/chess/arena-setup.js'
import { KEKE_ID } from '../keke/keke-ids.js'
import { ensureKeke } from '../keke/keke-setup.js'
import { db, migrate, pool, reset } from '../test-db.js'
import { AUTOMATED_AVATARS, ensureAutomatedAvatars } from './automated-avatars.js'

// HeyNaija's automated accounts get their photos at start-up, made like an upload.
class Store {
  files = new Map<string, Buffer>()
  async write(bucket: string, key: string, body: Buffer) {
    this.files.set(`${bucket}/${key}`, body)
  }
}

let store: Store
before(migrate)
beforeEach(async () => {
  await reset()
  store = new Store()
})
after(() => pool.end())

const avatarOf = async (id: string) => (await db.select({ a: members.avatarMediaId }).from(members).where(eq(members.id, id)))[0]?.a

test('Keke and The Arbiter get their photos: square WebP at both sizes, a ready media row, and the member pointing at it', async () => {
  await ensureArena(db)
  await ensureKeke(db)
  await ensureAutomatedAvatars(db, store)
  for (const avatar of AUTOMATED_AVATARS) {
    assert.equal(await avatarOf(avatar.memberId), avatar.mediaId)
    for (const px of [96, 256]) {
      const file = store.files.get(`media/avatars/${avatar.mediaId}/${px}.webp`)
      assert.ok(file, `${avatar.mediaId} ${px}`)
      const meta = await sharp(file).metadata()
      assert.deepEqual([meta.format, meta.width, meta.height], ['webp', px, px])
    }
  }
  const rows = await db.select().from(media).where(inArray(media.id, AUTOMATED_AVATARS.map((a) => a.mediaId)))
  assert.deepEqual(rows.map((r) => [r.kind, r.status]).sort(), [['avatar', 'ready'], ['avatar', 'ready']])

  // Every start after that does nothing.
  store.files.clear()
  await ensureAutomatedAvatars(db, store)
  assert.equal(store.files.size, 0)
})

test('a photo a moderator removed comes back; one that is not ours is left alone; an account not made yet is skipped', async () => {
  await ensureKeke(db)
  // The Arbiter does not exist yet (Games has not started): no error, nothing for it.
  await ensureAutomatedAvatars(db, store)
  assert.equal(await avatarOf(ARBITER_ID), undefined)
  assert.equal(store.files.size, 2)

  await db.update(members).set({ avatarMediaId: null }).where(eq(members.id, KEKE_ID))
  await ensureAutomatedAvatars(db, store)
  assert.equal(await avatarOf(KEKE_ID), AUTOMATED_AVATARS[0].mediaId)

  const other = '0c0c0c0c-0000-4000-8000-000000000001'
  await db.insert(media).values({ id: other, ownerId: KEKE_ID, kind: 'avatar', status: 'ready', contentType: 'image/webp', bytes: 1 })
  await db.update(members).set({ avatarMediaId: other }).where(eq(members.id, KEKE_ID))
  await ensureAutomatedAvatars(db, store)
  assert.equal(await avatarOf(KEKE_ID), other)
})
