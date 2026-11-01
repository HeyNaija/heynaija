import assert from 'node:assert/strict'
import { afterEach, mock, test } from 'node:test'
import { Logger } from '@nestjs/common'
import { type Mail, type Mailer, PermanentMailError } from '../email/mailer.js'
import { EmailDeletionNotices, erasedEmail, scheduledEmail } from './deletion-notices.js'

const WEB = 'https://heynaija.test'
// 23:30 UTC on 12 November is already 13 November in Lagos.
const lateEvening = new Date('2026-11-12T23:30:00Z')

class Outbox implements Mailer {
  readonly sent: Mail[] = []
  fail: Error | null = null
  async send(mail: Mail) {
    if (this.fail) throw this.fail
    this.sent.push(mail)
  }
}

// Kratos's answer: an address only for an account that proved it has one.
const addresses = { addressFor: async (memberId: string) => (memberId === 'ada' ? 'ada@example.test' : null) }

afterEach(() => mock.restoreAll())

test('the scheduled email gives the date in Lagos and how to keep the account, and cannot be unsubscribed from', () => {
  const mail = scheduledEmail('ada@example.test', lateEvening, WEB)
  assert.equal(mail.to, 'ada@example.test')
  assert.equal(mail.subject, 'Your HeyNaija account will be deleted on 13 November 2026')
  assert.match(mail.text, /signed out everywhere\. We will erase it on 13 November 2026\./)
  assert.match(mail.text, /Sign in before then and choose Keep my account: https:\/\/heynaija\.test\/login/)
  assert.match(mail.text, /If you did not ask for this, do the same/)
  assert.match(mail.html, /<strong>13 November 2026<\/strong>/)
  assert.match(mail.html, /href="https:\/\/heynaija\.test\/login"/)
  assert.match(mail.html, /href="https:\/\/heynaija\.test\/privacy#keep"/)
  assert.equal(mail.unsubscribeUrl, undefined)
})

test('the erased email says what is gone and how to come back', () => {
  const mail = erasedEmail('ada@example.test', WEB)
  assert.equal(mail.subject, 'Your HeyNaija account has been deleted')
  assert.match(mail.text, /has been erased, as you asked/)
  assert.match(mail.text, /join again with a new invite/)
  assert.match(mail.html, /href="https:\/\/heynaija\.test\/privacy#keep"/)
  assert.equal(mail.unsubscribeUrl, undefined)
})

test('the scheduled email goes to the address Kratos has, and nowhere without one', async () => {
  const outbox = new Outbox()
  const notices = new EmailDeletionNotices(outbox, addresses, WEB)
  await notices.scheduled('ada', lateEvening)
  await notices.scheduled('no-proved-address', lateEvening)
  assert.deepEqual(outbox.sent.map((m) => [m.to, m.subject]), [['ada@example.test', 'Your HeyNaija account will be deleted on 13 November 2026']])
  await notices.erased('ada@example.test')
  assert.equal(outbox.sent[1]!.subject, 'Your HeyNaija account has been deleted')
})

test('with no mail server nothing is sent and no address is looked up', async () => {
  let asked = 0
  const notices = new EmailDeletionNotices(null, { addressFor: async () => (asked++, 'ada@example.test') }, WEB)
  await notices.scheduled('ada', lateEvening)
  await notices.erased('ada@example.test')
  assert.equal(asked, 0)
})

test('a dead address does not hold up the erase, and is not logged; a mail server that is away does hold it up', async () => {
  const logged: string[] = []
  mock.method(Logger.prototype, 'warn', (message: string) => void logged.push(message))
  const outbox = new Outbox()
  const notices = new EmailDeletionNotices(outbox, addresses, WEB)

  outbox.fail = new PermanentMailError("Can't send mail - all recipients were rejected: 550 <ada@example.test>: no such user")
  await notices.erased('ada@example.test')
  assert.equal(logged.length, 1)
  assert.doesNotMatch(logged[0]!, /ada@example\.test/)

  // Tried again with the erase, which waits for it.
  outbox.fail = Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNECTION' })
  await assert.rejects(notices.erased('ada@example.test'), /ECONNREFUSED/)
})
