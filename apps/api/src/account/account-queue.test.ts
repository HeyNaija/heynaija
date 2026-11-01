import assert from 'node:assert/strict'
import { after, afterEach, beforeEach, mock, test } from 'node:test'
import { Logger } from '@nestjs/common'
import type { Queue } from 'bullmq'
import { sql } from 'drizzle-orm'
import { AuthProviderError } from '../auth/auth-session.provider.js'
import type { Env } from '../env.js'
import { db, pool } from '../test-db.js'
import { AccountDeletionError } from './account-deletion.service.js'
import { AccountWorker, BullAccountJobs } from './account-queue.js'
import { failureReason } from './failure-reason.js'

const now = new Date('2026-10-30T09:00:00Z')

// The services the worker calls are stood in for, and the queue records what is
// added to it. `now` is passed in, as BullMQ's clock would be.
let calls: { due: Date[]; erased: [string, Date][]; swept: Date[]; checked: Date[] }
let queued: string[]
let logged: string[]
let eraseFails: Error | null
let swept: { posts: number; handles: number }
let overdue: { id: string; kind: string; dueBy: Date }[]

const worker = () =>
  new AccountWorker(
    { REDIS_URL: 'redis://unused' } as Env,
    {
      due: async (at = new Date()) => {
        calls.due.push(at)
        return ['m1', 'm2']
      },
      erase: async (memberId, at = new Date()) => {
        if (eraseFails) throw eraseFails
        calls.erased.push([memberId, at])
        return 'erased'
      },
    },
    {
      sweep: async (at = new Date()) => {
        calls.swept.push(at)
        return swept
      },
    },
    {
      overdue: async (at = new Date()) => {
        calls.checked.push(at)
        return overdue
      },
    },
    { erase: async (memberId) => void queued.push(memberId), queue: {} as Queue },
  )

beforeEach(() => {
  calls = { due: [], erased: [], swept: [], checked: [] }
  queued = []
  logged = []
  eraseFails = null
  swept = { posts: 0, handles: 0 }
  overdue = []
  for (const level of ['log', 'warn', 'error'] as const) {
    mock.method(Logger.prototype, level, (message: string) => void logged.push(`${level}: ${message}`))
  }
})
afterEach(() => mock.restoreAll())
after(() => pool.end())

test('every hour, each account due is queued for erasing, and its erase job erases it', async () => {
  const w = worker()
  await w.run({ name: 'queue-due', data: {} }, now)
  assert.deepEqual(calls.due, [now])
  assert.deepEqual(queued, ['m1', 'm2'])
  await w.run({ name: 'erase', data: { memberId: 'm1' } }, now)
  assert.deepEqual(calls.erased, [['m1', now]])
})

/** BullAccountJobs on a stand-in queue holding at most `existing`, recording what is added and removed. */
function jobsWith(existing?: { failed: boolean; finishedOn: number }) {
  const added: unknown[][] = []
  const removed: string[] = []
  const jobs = Object.create(BullAccountJobs.prototype) as BullAccountJobs
  const job = existing && { ...existing, isFailed: async () => existing.failed, remove: async () => void removed.push('erase-m1') }
  Object.defineProperty(jobs, 'queue', {
    value: { getJob: async (id: string) => (id === 'erase-m1' ? job : undefined), add: async (...args: unknown[]) => void added.push(args) },
  })
  return { jobs, added, removed }
}

test('an account is queued under its own ID, and a finished erase job is removed at once', async () => {
  const { jobs, added } = jobsWith()
  await jobs.erase('m1')
  const [name, data, opts] = added[0] as [string, unknown, { jobId: string; removeOnComplete: boolean; attempts: number }]
  assert.deepEqual([name, data, opts.jobId, opts.removeOnComplete, opts.attempts], ['erase', { memberId: 'm1' }, 'erase-m1', true, 8])
})

test('an erase that gave up is let go after a day, or at once for --now, so the account is queued again', async () => {
  const hour = 3600 * 1000
  // BullMQ itself would keep it until some other job failed.
  const recent = jobsWith({ failed: true, finishedOn: Date.now() - 23 * hour })
  await recent.jobs.erase('m1')
  assert.deepEqual(recent.removed, [], 'still waiting out its day')

  const old = jobsWith({ failed: true, finishedOn: Date.now() - 25 * hour })
  await old.jobs.erase('m1')
  assert.deepEqual([old.removed, old.added.length], [['erase-m1'], 1])

  const operator = jobsWith({ failed: true, finishedOn: Date.now() - hour })
  await operator.jobs.erase('m1', { retryNow: true })
  assert.deepEqual(operator.removed, ['erase-m1'])

  // One still being tried is left alone: it is that account's erase.
  const running = jobsWith({ failed: false, finishedOn: 0 })
  await running.jobs.erase('m1', { retryNow: true })
  assert.deepEqual(running.removed, [])
})

test('the sweep and the overdue check log counts and request IDs, and stay quiet with nothing to say', async () => {
  const w = worker()
  await w.run({ name: 'retention', data: {} }, now)
  await w.run({ name: 'overdue', data: {} }, now)
  assert.deepEqual([calls.swept, calls.checked, logged], [[now], [now], []])

  swept = { posts: 2, handles: 1 }
  overdue = [{ id: 'r1', kind: 'deletion', dueBy: new Date('2026-10-29T09:00:00Z') }]
  await w.run({ name: 'retention', data: {} }, now)
  await w.run({ name: 'overdue', data: {} }, now)
  assert.deepEqual(logged, [
    'log: blanked 2 deleted posts kept longer than DELETED_CONTENT_RETENTION_DAYS',
    'log: let go of 1 handles held for erased accounts',
    'warn: 1 privacy requests are past their due date: r1 (deletion, due 2026-10-29)',
  ])
})

test('a failure is kept and logged by its kind, never by a message that may hold personal data', async () => {
  // Drizzle's message has the query's parameters, and Postgres's can repeat one.
  const query = await db.execute(sql`select ${'xena'}::int`).then(() => assert.fail('Postgres took it'), (err: Error) => err)
  assert.match(query.message, /xena/)
  assert.equal(failureReason(query), 'database error 22P02')
  const mail = Object.assign(new Error("Can't send mail - all recipients were rejected: 550 <xena@example.test>"), { code: 'EENVELOPE' })
  assert.equal(failureReason(mail), 'Error EENVELOPE')
  assert.equal(failureReason(new TypeError('xena is not a function')), 'TypeError')
  // Messages written here are kept.
  assert.equal(failureReason(new AuthProviderError('unavailable')), 'authentication provider unavailable')
  assert.equal(failureReason(new AccountDeletionError('not_due', 'that deletion is not due yet')), 'that deletion is not due yet')

  eraseFails = mail
  await assert.rejects(worker().run({ name: 'erase', data: { memberId: 'm1' } }, now), { message: 'Error EENVELOPE' })
})

test('giving up on an erase is an error naming the member; a try that will be repeated is a warning', () => {
  const w = worker()
  const job = (attemptsMade: number) => ({ name: 'erase', id: 'erase-m1', data: { memberId: 'm1' }, attemptsMade, opts: { attempts: 8 } })
  w.failed(job(3), new Error('authentication provider unavailable'))
  w.failed(job(8), new Error('authentication provider unavailable'))
  assert.deepEqual(logged, [
    'warn: erase erase-m1 failed: authentication provider unavailable',
    'error: gave up erasing member m1 after 8 tries (authentication provider unavailable). The account stays off the site and the erase is tried again in a day.',
  ])
})
