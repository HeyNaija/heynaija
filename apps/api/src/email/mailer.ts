import nodemailer, { type Transporter } from 'nodemailer'
import type { Env } from '../env.js'

export const MAILER = Symbol('MAILER')

export type Mail = {
  to: string
  subject: string
  text: string
  html: string
  /**
   * Where the List-Unsubscribe header points: one request turns the emails off.
   * Left out for messages to the people running the service, which are not optional.
   */
  unsubscribeUrl?: string
}

/** Somewhere to send a message. */
export interface Mailer {
  send(mail: Mail): Promise<void>
}

/** The mail server refused this message for good; sending it again would fail the same way. */
export class PermanentMailError extends Error {}

// Authentication problems are ours to fix (and the message is fine), so they are
// retried like any other trouble; every other 5xx is about the message or the address.
const NOT_THE_MESSAGES_FAULT = new Set([530, 534, 535])

export class SmtpMailer implements Mailer {
  constructor(
    private readonly transport: Pick<Transporter, 'sendMail'>,
    private readonly from: { name: string; address: string },
  ) {}

  async send(mail: Mail): Promise<void> {
    try {
      await this.transport.sendMail({
        from: this.from,
        to: mail.to,
        subject: mail.subject,
        text: mail.text,
        html: mail.html,
        headers: {
          // RFC 8058: the address is a link a mail program may POST to without
          // showing anything, which is how "Unsubscribe" buttons in inboxes work.
          ...(mail.unsubscribeUrl
            ? { 'List-Unsubscribe': `<${mail.unsubscribeUrl}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' }
            : {}),
          // Nobody reads replies, so out-of-office programs should not send any.
          'Auto-Submitted': 'auto-generated',
        },
      })
    } catch (error) {
      const code = (error as { responseCode?: number }).responseCode
      if (typeof code === 'number' && code >= 500 && code < 600 && !NOT_THE_MESSAGES_FAULT.has(code)) {
        throw new PermanentMailError(error instanceof Error ? error.message : `SMTP ${code}`)
      }
      throw error
    }
  }
}

// Short enough that a mail server that stops answering frees its worker in good time.
const TIMEOUTS = { connectionTimeout: '10000', greetingTimeout: '10000', socketTimeout: '20000' }

/** A mailer for the SMTP account in the environment, or null when none is set. */
export function smtpMailer(env: Pick<Env, 'SMTP_CONNECTION_URI' | 'SMTP_FROM_ADDRESS' | 'SMTP_FROM_NAME'>): Mailer | null {
  if (!env.SMTP_CONNECTION_URI || !env.SMTP_FROM_ADDRESS) return null
  // The same connection string Kratos is given (smtps://user:key@host:465/).
  const url = new URL(env.SMTP_CONNECTION_URI)
  for (const [name, value] of Object.entries(TIMEOUTS)) if (!url.searchParams.has(name)) url.searchParams.set(name, value)
  return new SmtpMailer(nodemailer.createTransport(url.toString()), {
    name: env.SMTP_FROM_NAME,
    address: env.SMTP_FROM_ADDRESS,
  })
}
