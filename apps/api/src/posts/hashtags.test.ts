import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, beforeEach, test } from 'node:test'
import { blocks, members, mutes, postHashtags, posts } from '@heynaija/db'
import { eq } from 'drizzle-orm'
import { db, migrate, pool, reset } from '../test-db.js'
import { findHashtags, parseHashtag } from './hashtags.js'
import { PostsService } from './posts.service.js'

const service = new PostsService(db)
const ada = randomUUID()
const bayo = randomUUID()
const chi = randomUUID()

before(migrate)
beforeEach(async () => {
  await reset()
  await db.insert(members).values([
    { id: ada, handle: 'ada' },
    { id: bayo, handle: 'bayo' },
    { id: chi, handle: 'chi' },
  ])
})
after(() => pool.end())

const tags = (text: string) => findHashtags(text).map((h) => h.tag)
const tagged = async (viewerId: string | null, tag: string) =>
  (await service.withHashtag(viewerId, tag, 100)).posts.map((p) => p.text)

test('#hashtags are found where they stand alone, and every spelling is one topic', () => {
  assert.deepEqual(tags('#Naija to the world, (#EndSARS) #endsars! #jollof_wars.'), ['naija', 'endsars', 'endsars', 'jollof_wars'])
  // Letters with accents and tone marks, composed or not, are one word.
  const osun = '\u1ecc\u0300\u1e63un' // Ọ̀ṣun, its tone mark a character of its own
  assert.deepEqual(tags(`#${osun} #${osun.toUpperCase()} #Kúnlé`), ['\u1ecd\u0300\u1e63un', '\u1ecd\u0300\u1e63un', 'kúnlé'])
  assert.deepEqual(tags('#K\u00fanl\u00e9 #Ku\u0301nle\u0301'), ['k\u00fanl\u00e9', 'k\u00fanl\u00e9'], 'composed or not')
  // A number is not a topic, but a word with numbers in it is.
  assert.deepEqual(tags('#1 #2027 #_ #2027Elections #9ja'), ['2027elections', '9ja'])
  // Not inside a word, an address, an HTML entity or a doubled ##, and not longer than 50.
  assert.deepEqual(tags('C# no#1 &#39; ##ad https://example.com/story#comments www.example.ng/#top'), [])
  assert.deepEqual(tags(`#${'a'.repeat(50)} #${'b'.repeat(51)}`), ['a'.repeat(50)])
  // Offsets are in UTF-16 code units, as JavaScript slices text.
  const text = '🇳🇬 up #Naija'
  const [found] = findHashtags(text)
  assert.equal(text.slice(found!.start, found!.start + found!.length), '#Naija')
})

test('a topic page address is a hashtag as written, without its #', () => {
  assert.equal(parseHashtag('EndSARS'), 'endsars')
  assert.equal(parseHashtag('\u1ecc\u0300\u1e63un'), '\u1ecd\u0300\u1e63un')
  for (const bad of ['', '#endsars', '2027', 'end sars', 'end-sars', 'a'.repeat(51), "x'; drop table posts; --"]) {
    assert.equal(parseHashtag(bad), null, bad)
  }
})

test('hashtags are stored with the post, and the post shows them as written', async () => {
  const text = 'Rain in #Lagos again. #lagos traffic, as ever'
  const { id } = await service.create(ada, text)
  const post = (await service.post(null, id))!
  assert.deepEqual(
    post.hashtags.map((h) => [text.slice(h.start, h.start + h.length), h.tag]),
    [
      ['#Lagos', 'lagos'],
      ['#lagos', 'lagos'],
    ],
  )
  assert.equal((await db.select().from(postHashtags).where(eq(postHashtags.postId, id))).length, 2)
})

test('a hashtag lists its posts and replies newest first, however it is spelled, each once', async () => {
  const root = await service.create(ada, 'Who else is watching #BBNaija?')
  await service.create(bayo, '#bbnaija every night, #BBNAIJA forever', { replyTo: root.id })
  await service.create(chi, 'Quiet night, no TV')
  await service.create(chi, '#bbnaija2 is not the same show')
  assert.deepEqual(await tagged(null, 'bbnaija'), ['#bbnaija every night, #BBNAIJA forever', 'Who else is watching #BBNaija?'])
  assert.deepEqual(await tagged(null, 'nothing'), [])
})

test('a hashtag page pages through its posts', async () => {
  for (let i = 0; i < 5; i++) await service.create(ada, `#suya take ${i}`)
  const first = await service.withHashtag(null, 'suya', 3)
  assert.deepEqual(first.posts.map((p) => p.text), ['#suya take 4', '#suya take 3', '#suya take 2'])
  const second = await service.withHashtag(null, 'suya', 3, first.cursor!)
  assert.deepEqual(second.posts.map((p) => p.text), ['#suya take 1', '#suya take 0'])
  assert.equal(second.cursor, null)
})

test('a hashtag leaves out what the reader could not see anywhere else', async () => {
  await service.create(ada, '#jollof by ada')
  await service.create(bayo, '#jollof by bayo')
  const deleted = await service.create(chi, '#jollof deleted')
  await service.remove(chi, deleted.id)
  const removed = await service.create(chi, '#jollof taken down')
  await db.update(posts).set({ removedAt: new Date() }).where(eq(posts.id, removed.id))
  assert.deepEqual(await tagged(null, 'jollof'), ['#jollof by bayo', '#jollof by ada'])

  // Blocks either way and mutes hide an author, as in every feed.
  await db.insert(blocks).values({ blockerId: bayo, blockedId: chi })
  await db.insert(mutes).values({ muterId: chi, mutedId: ada })
  assert.deepEqual(await tagged(chi, 'jollof'), [])
  // A suspended member's posts are gone from it too.
  await db.update(members).set({ active: false }).where(eq(members.id, ada))
  assert.deepEqual(await tagged(null, 'jollof'), ['#jollof by bayo'])
})

test('a deleted post shows no hashtags', async () => {
  const root = await service.create(ada, 'root')
  const { id } = await service.create(bayo, 'gone #soon', { replyTo: root.id })
  const { id: child } = await service.create(chi, 'still here', { replyTo: id })
  await service.remove(bayo, id)
  // The deleted reply is a placeholder above the one under it.
  const thread = (await service.thread(null, child))!
  assert.deepEqual(thread.ancestors.map((p) => [p.deleted, p.hashtags]), [[false, []], [true, []]])
})

test('replies and quotes record hashtags too, and threads show them', async () => {
  const { id: root } = await service.create(bayo, 'root')
  await service.create(ada, 'agreed #facts', { replyTo: root })
  const { id: quote } = await service.create(ada, '#facts, see this', { quote: root })
  const thread = (await service.thread(null, root))!
  assert.deepEqual(thread.replies.map((r) => !r.unavailable && r.hashtags.map((h) => h.tag)), [['facts']])
  assert.deepEqual((await service.post(null, quote))!.hashtags.map((h) => h.tag), ['facts'])
})
