import { env } from './env.ts'

type Message = { ID: string; Created: string; Snippet: string; Subject: string; To: { Address: string }[] }

/**
 * The newest six-digit code mailed to `email` since `since`. Kratos sends
 * sign-up and sign-in codes; Mailpit catches every email the dev stack sends.
 */
export async function codeFor(email: string, since: Date, timeoutMs = 30_000): Promise<string> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const message = (await messagesFor(email, since))[0]
    const code = message && (message.Snippet.match(/\b(\d{6})\b/)?.[1] ?? message.Subject.match(/\b(\d{6})\b/)?.[1])
    if (code) return code
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
