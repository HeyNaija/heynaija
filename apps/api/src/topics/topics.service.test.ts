import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, beforeEach, test } from 'node:test'
import { members, posts } from '@heynaija/db'
import { eq, inArray } from 'drizzle-orm'
import { PostsService } from '../posts/posts.service.js'
import { db, migrate, pool, reset } from '../test-db.js'
import { label, TOPIC_MIN_MEMBERS, TOPIC_WINDOW_DAYS, TopicsService, TOPICS_TTL_MS } from './topics.service.js'

const postsService = new PostsService(db)
const people = Array.from({ length: 5 }, () => randomUUID())
const [ada, bayo, chi, dayo, eze] = people as [string, string, string, string, string]

before(migrate)
beforeEach(async () => {
  await reset()
  await db.insert(members).values(people.map((id, i) => ({ id, handle: `member_${i}` })))
})
after(() => pool.end())

const post = (authorId: string, text: string) => postsService.create(authorId, text)
/** Each topic as label, members, posts, from a fresh service so nothing is cached. */
const ranked = async () =>
  (await new TopicsService(db).trending()).topics.map((t) => `${t.label} ${t.members}/${t.posts}`)

test('a topic trends once enough different members use it, ranked by members, then posts', async () => {
  // Four people on #Jollof, three on #Suya (one of them twice), two on #Rice.
  for (const id of [ada, bayo, chi, dayo]) await post(id, `#Jollof take from ${id}`)
  for (const id of [ada, bayo, chi]) await post(id, 'Suya tonight #Suya')
  await post(chi, 'More #suya, and again #SUYA')
  for (const id of [dayo, eze]) await post(id, '#Rice is life')
  assert.deepEqual(await ranked(), ['Jollof 4/4', 'Suya 3/4'])
})

test('one member using a hashtag many times is still one member', async () => {
  for (let i = 0; i < 10; i++) await post(ada, `#OnlyMe number ${i}`)
  await post(bayo, '#OnlyMe too')
  assert.deepEqual(await ranked(), [])
  await post(chi, 'and me #onlyme')
  assert.deepEqual(await ranked(), ['OnlyMe 3/12'])
})

test('replies and quotes count; ties go to more posts, then the latest use', async () => {
  const root = await post(ada, '#Older first')
  await postsService.create(bayo, 'agreed #Older', { replyTo: root.id })
  await postsService.create(chi, '#Older, see this', { quote: root.id })
  for (const id of [ada, bayo, chi]) await post(id, '#Newer here')
  // Both: three members, three posts. #Newer was used last.
  assert.deepEqual(await ranked(), ['Newer 3/3', 'Older 3/3'])
  await post(dayo, 'one more #older')
  assert.deepEqual(await ranked(), ['Older 4/4', 'Newer 3/3'])
})

test('deleted and taken-down posts, suspended members and last week do not count', async () => {
  const uses = []
  for (const id of [ada, bayo, chi, dayo]) uses.push(await post(id, `#Gist from ${id}`))
  assert.deepEqual(await ranked(), ['Gist 4/4'])

  await postsService.remove(ada, uses[0]!.id)
  await db.update(posts).set({ removedAt: new Date() }).where(eq(posts.id, uses[1]!.id))
  assert.deepEqual(await ranked(), [])

  await post(eze, '#gist again')
  assert.deepEqual(await ranked(), ['Gist 3/3'])
  await db.update(members).set({ active: false }).where(eq(members.id, eze))
  assert.deepEqual(await ranked(), [])
  await db.update(members).set({ active: true }).where(eq(members.id, eze))

  const lastWeek = new Date(Date.now() - (TOPIC_WINDOW_DAYS * 86_400_000 + 60_000))
  await db.update(posts).set({ createdAt: lastWeek }).where(inArray(posts.id, [uses[2]!.id]))
  assert.deepEqual(await ranked(), [])
})

test('a topic is shown as most of its uses spell it', async () => {
  await post(ada, '#endsars')
  await post(bayo, '#EndSARS')
  await post(chi, '🇳🇬 #EndSARS')
  await post(dayo, '#ENDSARS')
  const [topic] = (await new TopicsService(db).trending()).topics
  assert.deepEqual(topic, { tag: 'endsars', label: 'EndSARS', members: 4, posts: 4 })
})

test('the rules sent with the topics are the ones applied', async () => {
  const { rules } = await new TopicsService(db).trending()
  assert.deepEqual(rules, { windowDays: TOPIC_WINDOW_DAYS, minMembers: TOPIC_MIN_MEMBERS, refreshSeconds: TOPICS_TTL_MS / 1000 })
})

test('the most common spelling wins, the most recent on a tie', () => {
  const use = (text: string) => ({ text, start: text.indexOf('#'), length: text.length - text.indexOf('#') })
  assert.equal(label('naija', [use('#Naija'), use('#naija'), use('#naija')]), 'naija')
  assert.equal(label('naija', [use('#Naija'), use('#NAIJA')]), 'Naija')
  assert.equal(label('naija', []), 'naija')
})
