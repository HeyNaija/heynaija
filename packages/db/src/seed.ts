// Creates the launch communities. Safe to re-run: existing ones are left as they
// are, so edits made later (by moderators, or by hand) are never overwritten.
import { createDb } from './index.js'
import { communities } from './schema.js'

const RULES = [
  'Be respectful. No harassment, hate speech or threats.',
  'Stay on topic for this community.',
  'No spam, scams or misleading promotions.',
  'Do not share other people\'s private information.',
].join('\n')

const SEED = [
  {
    slug: 'tech-careers',
    name: 'Tech & Careers',
    description: 'Building, shipping and getting hired. Jobs, side projects, career advice and the Nigerian tech scene.',
  },
  {
    slug: 'universities',
    name: 'Universities',
    description: 'Campus life across Nigeria: admissions, courses, strikes, scholarships and student wins.',
  },
  {
    slug: 'lagos',
    name: 'Lagos',
    description: 'Everything Lagos: traffic, food, events, housing and neighbourhood news.',
  },
  {
    slug: 'abuja',
    name: 'Abuja',
    description: 'Life in the capital: what is happening around town, places to go and local recommendations.',
  },
  {
    slug: 'entertainment',
    name: 'Entertainment',
    description: 'Music, Nollywood, football, TV and everything people are talking about this week.',
  },
]

const url = process.env.DATABASE_URL
if (!url) throw new Error('DATABASE_URL is not set')

const { db, pool } = createDb(url)
const created = await db
  .insert(communities)
  .values(SEED.map((c) => ({ ...c, rules: RULES })))
  .onConflictDoNothing({ target: communities.slug })
  .returning({ slug: communities.slug })
await pool.end()

console.log(created.length ? `created: ${created.map((c) => c.slug).join(', ')}` : 'communities already exist')
