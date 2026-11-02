import { Logger } from '@nestjs/common'
import type { EmailAddresses } from '../email/addresses.js'
import { button, emailFrame, escapeHtml, link, paragraph } from '../email/layout.js'
import { type Mail, type Mailer, PermanentMailError } from '../email/mailer.js'
import type { DeletionNotices } from './account-deletion.service.js'

// Dates as members read them: Lagos time, "13 November 2026".
const DAY = new Intl.DateTimeFormat('en-NG', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Africa/Lagos' })

/** "Your account will be deleted on …": what happened, when, and how to keep it. */
export function scheduledEmail(to: string, scheduledFor: Date, webUrl: string): Mail {
  const on = DAY.format(scheduledFor)
  const signIn = `${webUrl}/login`
  const text = [
    'You asked us to delete your HeyNaija account.',
    '',
    `It is off HeyNaija now, and you have been signed out everywhere. We will erase it on ${on}.`,
    '',
    `Changed your mind? Sign in before then and choose Keep my account: ${signIn}`,
    'If you did not ask for this, do the same, so your account is kept.',
    '',
    `What is erased and what is kept: ${webUrl}/privacy#keep`,
  ].join('\n')
  const html = emailFrame({
    title: 'Your HeyNaija account will be deleted',
    preheader: `We will erase it on ${on}. You can still keep it.`,
    body: [
      paragraph('You asked us to delete your HeyNaija account.', 'font-size:17px;font-weight:600'),
      paragraph(`It is off HeyNaija now, and you have been signed out everywhere. We will erase it on <strong>${escapeHtml(on)}</strong>.`),
      paragraph('Changed your mind? Sign in before then and choose Keep my account. If you did not ask for this, do the same, so your account is kept.', 'margin:0'),
      button('Sign in to keep it', signIn),
    ].join('\n'),
    footer: `${link('What is erased and what is kept', `${webUrl}/privacy#keep`)}.`,
  })
  return { to, subject: `Your HeyNaija account will be deleted on ${on}`, text, html }
}

/** "Your account has been deleted": the last email to the address the account had. */
export function erasedEmail(to: string, webUrl: string): Mail {
  const text = [
    'Your HeyNaija account has been erased, as you asked.',
    '',
    'Your profile, your posts and your sign-in details are gone, and this address is no longer linked to HeyNaija. A few records are kept for a time, as our privacy policy explains.',
    '',
    'You are welcome back: join again with a new invite, as a new member.',
    '',
    `What is kept: ${webUrl}/privacy#keep`,
  ].join('\n')
  const html = emailFrame({
    title: 'Your HeyNaija account has been deleted',
    preheader: 'Your profile, posts and sign-in details are gone.',
    body: [
      paragraph('Your HeyNaija account has been erased, as you asked.', 'font-size:17px;font-weight:600'),
      paragraph('Your profile, your posts and your sign-in details are gone, and this address is no longer linked to HeyNaija. A few records are kept for a time, as our privacy policy explains.'),
      paragraph('You are welcome back: join again with a new invite, as a new member.', 'margin:0'),
    ].join('\n'),
    footer: `${link('What is kept', `${webUrl}/privacy#keep`)}.`,
  })
  return { to, subject: 'Your HeyNaija account has been deleted', text, html }
}

/**
 * The deletion emails (docs/adr/0016), through the notification mailer. With no
 * mail server configured nothing is sent, as with every other email. Neither is
 * optional for the member, so there is no unsubscribe link.
 */
export class EmailDeletionNotices implements DeletionNotices {
  private readonly log = new Logger('DeletionNotices')

  constructor(
    private readonly mailer: Mailer | null,
    private readonly addresses: EmailAddresses,
    private readonly webUrl: string,
  ) {}

  /** To the account's own address, which Kratos still has. A failure is the caller's to log. */
  async scheduled(memberId: string, scheduledFor: Date): Promise<void> {
    if (!this.mailer) return
    const to = await this.addresses.addressFor(memberId)
    if (to) await this.mailer.send(scheduledEmail(to, scheduledFor, this.webUrl))
  }

  /**
   * To the address the account had, read before Kratos forgot it. A refusal for
   * good (a dead address) is logged and the erase goes on; anything else throws,
   * so the erase tries again and the email has another chance.
   */
  async erased(email: string): Promise<void> {
    if (!this.mailer) return
    try {
      await this.mailer.send(erasedEmail(email, this.webUrl))
    } catch (err) {
      if (!(err instanceof PermanentMailError)) throw err
      // Its message can name the address, so it is not logged.
      this.log.warn('the mail server refused the "account deleted" email for good; the erase goes on without it')
    }
  }
}
