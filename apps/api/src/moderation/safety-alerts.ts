import { Logger } from '@nestjs/common'
import type { Mailer } from '../email/mailer.js'

export const SAFETY_ALERTS = Symbol('SAFETY_ALERTS')

/**
 * Tells whoever handles safety that something needs a person soon: an upload
 * the scanner matched, or a member's report of illegal content. The message says
 * only what happened and where to look; it never carries the content itself.
 */
export interface SafetyAlerts {
  alert(subject: string, lines: string[]): Promise<void>
}

/**
 * Emails SAFETY_ALERT_EMAIL. Every alert is also an error-level log line, so it
 * is on record with no email configured, or when sending fails. Never throws:
 * a report or an upload must not fail because an alert could not be sent.
 */
export class EmailSafetyAlerts implements SafetyAlerts {
  private readonly log = new Logger('SafetyAlerts')

  constructor(
    private readonly mailer: Mailer | null,
    private readonly to: string | undefined,
    private readonly webUrl: string,
  ) {}

  async alert(subject: string, lines: string[]): Promise<void> {
    this.log.error(`${subject}: ${lines.join(' ')}`)
    if (!this.mailer || !this.to) return
    const text = [...lines, '', `Moderation queue: ${this.webUrl}/mod`, 'Runbook: docs/safety/abuse-material-scanning.md'].join('\n')
    try {
      await this.mailer.send({ to: this.to, subject: `[HeyNaija safety] ${subject}`, text, html: `<pre>${escapeHtml(text)}</pre>` })
    } catch (err) {
      this.log.error(`could not email the safety alert "${subject}": ${(err as Error).message}`)
    }
  }
}

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)
