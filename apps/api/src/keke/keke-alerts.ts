import { Logger } from '@nestjs/common'
import { escapeHtml } from '../email/layout.js'
import type { Mailer } from '../email/mailer.js'
import type { KekeAlerts } from './keke.service.js'

/**
 * Emails the operators about Keke (KEKE_ALERT_EMAIL, else SAFETY_ALERT_EMAIL).
 * Every alert is also a log line, so it is on record with no email configured or
 * when sending fails. Never throws: Keke's work must not fail for want of an email.
 */
export class EmailKekeAlerts implements KekeAlerts {
  private readonly log = new Logger('Keke')

  constructor(
    private readonly mailer: Mailer | null,
    private readonly to: string | undefined,
    private readonly webUrl: string,
  ) {}

  async budgetReached(spentUsd: number, budgetUsd: number): Promise<void> {
    const subject = 'Keke has reached its monthly cap'
    const lines = [
      `Keke's model has cost $${spentUsd.toFixed(2)} this month, against a cap of $${budgetUsd.toFixed(2)} (KEKE_MONTHLY_BUDGET_USD).`,
      'Keke is not answering until the first of next month (UTC). Members who mention it get no reply; nothing else changes.',
      'To let it go on, raise KEKE_MONTHLY_BUDGET_USD on the server and restart the API. This month’s numbers are on the moderation page.',
    ]
    this.log.warn(`${subject}: ${lines[0]}`)
    if (!this.mailer || !this.to) return
    const text = [...lines, '', `Moderation: ${this.webUrl}/mod`, 'How Keke works: docs/adr/0030-keke.md'].join('\n')
    try {
      await this.mailer.send({ to: this.to, subject: `[HeyNaija] ${subject}`, text, html: `<pre>${escapeHtml(text)}</pre>` })
    } catch (err) {
      this.log.error(`could not email "${subject}": ${(err as Error).message}`)
    }
  }
}
