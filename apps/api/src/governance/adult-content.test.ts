import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, beforeEach, test } from 'node:test'
import { ageAssurances, members } from '@heynaija/db'
import { sql } from 'drizzle-orm'
import { db, migrate, pool, reset } from '../test-db.js'
import { seesAdultContent } from './adult-content.js'
import { type AgeRecord, ageStatus, isAdultFor } from './age.js'
import { isMinor } from './minors.js'

// seesAdultContent is ageStatus + isAdultFor written again in SQL, so every read
// path can ask it inside the query that reads the posts, and isMinor (minors.ts)
// is ageStatus's under-18 band the same way. Here each is held to the same answer
// as age.ts for every kind of record there is.

before(migrate)
beforeEach(reset)
after(() => pool.end())

/** YYYY-MM-DD for someone who turns `years` old `days` from today (in Lagos); negative days are past. */
function born(years: number, days = 0): string {
  const today = new Date(Date.now() + 60 * 60 * 1000)
  const date = new Date(Date.UTC(today.getUTCFullYear() - years, today.getUTCMonth(), today.getUTCDate() + days))
  return date.toISOString().slice(0, 10)
}

type Row = Omit<AgeRecord, 'assuredAt' | 'withdrawnAt'> & { assuredAt?: Date; withdrawnAt?: Date | null }

const dated = (years: number, days = 0): Row => ({
  band: years >= 18 ? '18_plus' : 'under_18',
  method: 'self_declared',
  birthDate: born(years, days),
})

const CASES: [string, Row[], boolean][] = [
  ['no record at all', [], false],
  ['the old "18 or older" box, with no date', [{ band: '18_plus', method: 'self_declared', birthDate: null }], false],
  ['a date of birth 30 years ago', [dated(30)], true],
  ['an 18th birthday today', [dated(18)], true],
  ['an 18th birthday tomorrow', [dated(18, 1)], false],
  ['a date of birth 15 years ago', [dated(15)], false],
  ['an adult date, withdrawn', [{ ...dated(30), withdrawnAt: new Date() }], false],
  [
    "a moderator's under-18 decision over the member's adult date",
    [dated(30), { band: 'under_18', method: 'moderator_review', birthDate: null }],
    false,
  ],
  [
    "an ID check's adult answer over the member's under-18 date",
    [dated(15), { band: '18_plus', method: 'identity_provider', birthDate: null }],
    true,
  ],
  [
    'the newer of two moderator decisions',
    [
      { band: '18_plus', method: 'moderator_review', birthDate: null, assuredAt: new Date('2026-01-01T00:00:00Z') },
      { band: 'under_18', method: 'moderator_review', birthDate: null, assuredAt: new Date('2026-06-01T00:00:00Z') },
    ],
    false,
  ],
  [
    "a moderator's correction with a date, worked out today",
    [dated(15), { ...dated(25), method: 'moderator_review' }],
    true,
  ],
]

for (const [name, rows, expected] of CASES) {
  test(`${name}: ${expected ? 'an adult' : 'not an adult'}, in SQL as in ageStatus`, async () => {
    const id = randomUUID()
    await db.insert(members).values({ id, handle: `m${id.slice(0, 8)}` })
    const records = rows.map((row): AgeRecord => ({ ...row, assuredAt: row.assuredAt ?? new Date(), withdrawnAt: row.withdrawnAt ?? null }))
    if (records.length) {
      await db.insert(ageAssurances).values(records.map((record) => ({ memberId: id, ...record })))
    }
    const { rows: [answer] } = await db.execute<{ adult: boolean; minor: boolean }>(
      sql`select ${seesAdultContent(id)} as adult, ${isMinor(id)} as minor`,
    )
    const status = ageStatus(records, new Date())
    assert.equal(isAdultFor(status, 'age_restricted_content'), expected, 'ageStatus')
    assert.equal(answer!.adult, expected, 'seesAdultContent')
    assert.equal(answer!.minor, status.band === 'under_18', 'isMinor')
  })
}

test('signed out is never an adult', async () => {
  const { rows: [answer] } = await db.execute<{ adult: boolean }>(sql`select ${seesAdultContent(null)} as adult`)
  assert.equal(answer!.adult, false)
})
