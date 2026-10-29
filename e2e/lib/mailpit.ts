import { env } from './env.ts'

type Message = { ID: string; Created: string; Subject: string; To: { Address: string }[] }

/**
 * The newest six-digit code mailed to `email` since `since`. Kratos sends
 * sign-up and sign-in codes; Mailpit catches every email the dev stack sends.
 */
export async function codeFor(email: string, since: Date, timeoutMs = 30_000): Promise<string> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const message = (await messagesFor(email, since))[0]
    if (message) {
      // The code is in the plaintext body, never the subject or preview, and Mailpit's Snippet is cut short.
      const { Text } = (await (await fetch(`${env.mailpitUrl}/api/v1/message/${message.ID}`)).json()) as { Text: string }
      const code = Text.match(/\b(\d{6})\b/)?.[1]
      if (code) return code
    }
    await new Promise((r) => setTimeout(r, 400))
  }
  throw new Error(`no code for ${email} in Mailpit after ${timeoutMs / 1000}s`)
}

/** Every email to exactly `email` since `since`, newest first. */
export async function messagesFor(email: string, since: Date): Promise<Message[]> {
  const res = await fetch(`${env.mailpitUrl}/api/v1/search?query=${encodeURIComponent(`to:"${email}"`)}`)
  if (!res.ok) throw new Error(`Mailpit search: ${res.status}`)
  const { messages } = (await res.json()) as { messages: Message[] }
  // Mailpit's to: matches part of an address, so a search for a@x.test also
  // finds new_a@x.test. Mailpit lists newest first; allow a second of clock
  // skew between machines.
  return messages.filter((m) =>
    m.To.some((to) => to.Address.toLowerCase() === email.toLowerCase()) &&
    new Date(m.Created).getTime() >= since.getTime() - 1000)
}

/** Whether Mailpit answers; checked once before the run. */
export async function mailpitUp() {
  return fetch(`${env.mailpitUrl}/api/v1/info`).then((r) => r.ok, () => false)
}

export type Email = { id: string; subject: string; text: string; html: string; headers: Record<string, string[]> }

/**
 * The first email to `email` since `since` whose subject matches, read in full.
 * Notification emails go out a few minutes after the activity (the tests age the
 * notifications instead of waiting), so this waits for up to `timeoutMs`.
 */
export async function emailWhere(email: string, since: Date, subject: RegExp, timeoutMs = 90_000): Promise<Email> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const found = (await messagesFor(email, since)).find((m) => subject.test(m.Subject))
    if (found) {
      const [detail, headers] = await Promise.all([
        fetch(`${env.mailpitUrl}/api/v1/message/${found.ID}`).then((r) => r.json() as Promise<{ Text: string; HTML: string }>),
        fetch(`${env.mailpitUrl}/api/v1/message/${found.ID}/headers`).then((r) => r.json() as Promise<Record<string, string[]>>),
      ])
      return { id: found.ID, subject: found.Subject, text: detail.Text, html: detail.HTML, headers }
    }
    await new Promise((r) => setTimeout(r, 500))
  }
  throw new Error(`no email for ${email} matching ${subject} in Mailpit after ${timeoutMs / 1000}s`)
}

/** How many emails went to `email` since `since`. */
export async function countFor(email: string, since: Date): Promise<number> {
  return (await messagesFor(email, since)).length
}
