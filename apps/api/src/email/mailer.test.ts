import assert from 'node:assert/strict'
import { test } from 'node:test'
import nodemailer from 'nodemailer'
import { type Mail, PermanentMailError, SmtpMailer, smtpMailer } from './mailer.js'

const from = { name: 'HeyNaija', address: 'no-reply@heynaija.test' }
const mail: Mail = {
  to: 'ada@example.test',
  subject: '@bayo replied to your post',
  text: 'plain',
  html: '<p>html</p>',
  unsubscribeUrl: 'https://heynaija.test/api/v1/email/unsubscribe/TOKEN',
}

/** Runs the message through nodemailer's own message builder, without sending it anywhere. */
async function built(): Promise<string> {
  const transport = nodemailer.createTransport({ streamTransport: true, buffer: true, newline: 'unix' })
  let raw = ''
  await new SmtpMailer(
    { sendMail: async (message: Parameters<typeof transport.sendMail>[0]) => void (raw = (await transport.sendMail(message)).message.toString()) } as never,
    from,
  ).send(mail)
  return raw
}

test('every email goes out with the one-click unsubscribe headers, a text part and an HTML part', async () => {
  const raw = await built()
  assert.match(raw, /^From: HeyNaija <no-reply@heynaija\.test>$/m)
  assert.match(raw, /^To: ada@example\.test$/m)
  assert.match(raw, /^Subject: @bayo replied to your post$/m)
  assert.match(raw, /^List-Unsubscribe: <https:\/\/heynaija\.test\/api\/v1\/email\/unsubscribe\/TOKEN>$/m)
  assert.match(raw, /^List-Unsubscribe-Post: List-Unsubscribe=One-Click$/m)
  assert.match(raw, /^Auto-Submitted: auto-generated$/m)
  assert.match(raw, /Content-Type: text\/plain/)
  assert.match(raw, /Content-Type: text\/html/)
})

test('an alert to the people running the service carries no unsubscribe headers', async () => {
  const transport = nodemailer.createTransport({ streamTransport: true, buffer: true, newline: 'unix' })
  let raw = ''
  await new SmtpMailer(
    { sendMail: async (message: Parameters<typeof transport.sendMail>[0]) => void (raw = (await transport.sendMail(message)).message.toString()) } as never,
    from,
  ).send({ ...mail, unsubscribeUrl: undefined })
  assert.doesNotMatch(raw, /^List-Unsubscribe/m)
  assert.match(raw, /^Auto-Submitted: auto-generated$/m)
})

const failing = (error: unknown) => ({ sendMail: async () => Promise.reject(error) }) as never
const smtp = (code: number) => Object.assign(new Error(`${code} refused`), { responseCode: code })

test('a refusal of the message or the address is permanent; trouble reaching or logging in is not', async () => {
  await assert.rejects(new SmtpMailer(failing(smtp(550)), from).send(mail), PermanentMailError)
  await assert.rejects(new SmtpMailer(failing(smtp(553)), from).send(mail), PermanentMailError)
  for (const error of [smtp(421), smtp(451), smtp(535), smtp(530), Object.assign(new Error('refused'), { code: 'ECONNREFUSED' }), new Error('timeout')]) {
    await assert.rejects(new SmtpMailer(failing(error), from).send(mail), (thrown) => !(thrown instanceof PermanentMailError))
  }
})

test('no SMTP account means no mailer; the same connection string as Kratos is accepted', () => {
  assert.equal(smtpMailer({ SMTP_CONNECTION_URI: undefined, SMTP_FROM_ADDRESS: undefined, SMTP_FROM_NAME: 'HeyNaija' }), null)
  for (const uri of ['smtp://127.0.0.1:1026', 'smtps://resend:re_key@smtp.resend.com:465/', 'smtp://mailpit:1025/?disable_starttls=true']) {
    assert.ok(smtpMailer({ SMTP_CONNECTION_URI: uri, SMTP_FROM_ADDRESS: 'no-reply@mail.heynaija.ng', SMTP_FROM_NAME: 'HeyNaija' }), uri)
  }
  assert.throws(() => smtpMailer({ SMTP_CONNECTION_URI: 'not a url', SMTP_FROM_ADDRESS: 'a@b.test', SMTP_FROM_NAME: 'x' }))
})
