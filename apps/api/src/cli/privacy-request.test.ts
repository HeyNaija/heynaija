import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { after, before, beforeEach, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { members, privacyRequests } from '@heynaija/db'
import { eq } from 'drizzle-orm'
import { db, migrate, pool, reset } from '../test-db.js'

// The command as an operator runs it: the built script, against the test
// database, with a stand-in for Kratos's admin API that knows one address.
const script = fileURLToPath(new URL('./privacy-request.js', import.meta.url))
const ada = { id: randomUUID(), handle: 'ada', email: 'Ada@Example.test' }
const bola = { id: randomUUID(), handle: 'bola' }

let kratos: Server
let ended: string[]
let env: NodeJS.ProcessEnv

before(async () => {
  await migrate()
  kratos = createServer((req, res) => {
    const url = new URL(req.url!, 'http://kratos')
    if (req.method === 'GET' && url.pathname === '/admin/identities') {
      const asked = url.searchParams.get('credentials_identifier')
      const found = asked === ada.email.toLowerCase() ? [{ id: ada.id, traits: { email: ada.email.toLowerCase() } }] : []
      res.setHeader('content-type', 'application/json')
      return res.end(JSON.stringify(found))
    }
    const sessions = url.pathname.match(/^\/admin\/identities\/([^/]+)\/sessions$/)
    if (req.method === 'DELETE' && sessions) {
      ended.push(sessions[1]!)
      res.statusCode = 204
      return res.end()
    }
    res.statusCode = 404
    res.end()
  })
  await new Promise<void>((resolve) => kratos.listen(0, '127.0.0.1', resolve))
  env = {
    ...process.env,
    DATABASE_URL: process.env.TEST_DATABASE_URL,
    KRATOS_ADMIN_URL: `http://127.0.0.1:${(kratos.address() as AddressInfo).port}`,
    // Never reached without --now; nothing else it needs.
    REDIS_URL: 'redis://127.0.0.1:1',
    WEB_PUBLIC_URL: 'http://127.0.0.1:3000',
    ACCOUNT_DELETION_GRACE_DAYS: '14',
    PRIVACY_REQUEST_DUE_DAYS: '30',
  }
  // No mail server: the local .env may name Mailpit.
  delete env.SMTP_CONNECTION_URI
})
beforeEach(async () => {
  await reset()
  ended = []
  await db.insert(members).values([
    { id: ada.id, handle: ada.handle },
    { id: bola.id, handle: bola.handle },
  ])
})
after(async () => {
  kratos.close()
  await pool.end()
})

/** Runs the command; never throws, so a refusal can be checked. */
const cli = (...args: string[]) =>
  new Promise<{ code: number; out: string; err: string }>((resolve) => {
    execFile(process.execPath, [script, ...args], { env }, (error, stdout, stderr) => {
      resolve({ code: error ? Number(error.code ?? 1) : 0, out: stdout, err: stderr })
    })
  })
const idIn = (text: string) => text.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/)![0]
const request = async (id: string) => (await db.select().from(privacyRequests).where(eq(privacyRequests.id, id)))[0]!

test('an emailed request is recorded for the account with that address, listed, and completed', async () => {
  const recorded = await cli('record', '--email', ada.email, '--kind', 'access', '--notes', 'asked for a copy')
  assert.equal(recorded.code, 0, recorded.err)
  assert.match(recorded.out, /^recorded access request .* for @ada; due \d{4}-\d{2}-\d{2}/)
  const id = idIn(recorded.out)
  const row = await request(id)
  assert.deepEqual([row.memberId, row.kind, row.channel, row.status, row.notes], [ada.id, 'access', 'email', 'received', 'asked for a copy'])
  assert.equal(Math.round((row.dueBy.getTime() - row.receivedAt.getTime()) / 86_400_000), 30)

  const listed = await cli('list')
  assert.match(listed.out, new RegExp(`^${id}  access +received +email .* @ada$`, 'm'))
  assert.match((await cli('list', '--overdue')).out, /No privacy requests are overdue/)

  const done = await cli('complete', id, '--notes', 'sent the export')
  assert.equal(done.code, 0, done.err)
  assert.deepEqual([(await request(id)).status, (await request(id)).notes], ['completed', 'asked for a copy\nsent the export'])
  assert.match((await cli('list')).out, /No open privacy requests/)
})

test('an address no account has is recorded without one; an unknown handle, kind or command is refused', async () => {
  const stranger = await cli('record', '--email', 'someone@example.test', '--kind', 'objection')
  assert.match(stranger.out, /from an address no account has/)
  assert.equal((await request(idIn(stranger.out))).memberId, null)

  for (const args of [
    ['record', '--handle', 'nobody_here', '--kind', 'access'],
    ['record', '--handle', 'ada', '--kind', 'everything'],
    ['record', '--kind', 'access'],
    ['complete', randomUUID()],
    ['frobnicate'],
    [],
  ]) {
    const refused = await cli(...args)
    assert.equal(refused.code, 1, args.join(' '))
    assert.notEqual(refused.err.trim(), '', args.join(' '))
  }
  assert.match((await cli()).err, /^usage:/)
})

test('delete-account takes the account off the site under the request recorded when it arrived', async () => {
  const id = idIn((await cli('record', '--handle', '@Bola', '--kind', 'deletion')).out)
  // Deletions are completed by deleting, not by hand.
  assert.equal((await cli('complete', id)).code, 1)

  const deleted = await cli('delete-account', '--request', id)
  assert.equal(deleted.code, 0, deleted.err)
  assert.match(deleted.out, /^@bola is off HeyNaija and will be erased on \d{4}-\d{2}-\d{2}/)
  const [member] = await db.select().from(members).where(eq(members.id, bola.id))
  assert.deepEqual([member!.active, member!.deletionRequestedAt !== null], [false, true])
  const row = await request(id)
  assert.deepEqual([row.memberId, row.status, row.channel], [bola.id, 'in_progress', 'email'])
  assert.deepEqual(ended, [bola.id], 'signed out everywhere')
  assert.match((await cli('list')).out, new RegExp(`^${id}  deletion +in_progress`, 'm'))

  // Asking again for the same account changes nothing.
  assert.match((await cli('delete-account', '--handle', 'bola')).out, /already waiting for deletion/)
  assert.equal((await db.select().from(privacyRequests).where(eq(privacyRequests.memberId, bola.id))).length, 1)
})

test('overdue requests are marked, and listed on their own', async () => {
  const [late] = await db
    .insert(privacyRequests)
    .values({ memberId: ada.id, kind: 'correction', channel: 'email', status: 'verifying', receivedAt: new Date(Date.now() - 40 * 86_400_000), dueBy: new Date(Date.now() - 10 * 86_400_000) })
    .returning()
  await cli('record', '--handle', 'bola', '--kind', 'access')
  const overdue = (await cli('list', '--overdue')).out.trim().split('\n')
  assert.equal(overdue.length, 1)
  assert.match(overdue[0]!, new RegExp(`^${late!.id}  correction .* @ada  OVERDUE$`))
  assert.equal((await cli('list')).out.trim().split('\n').length, 2)
})
