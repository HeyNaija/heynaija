import { env } from './env.ts'

type Message = { ID: string; Created: string; Snippet: string; Subject: string }

/**
 * The newest six-digit code mailed to `email` since `since`. Kratos sends
 * sign-up and sign-in codes; Mailpit catches every email the dev stack sends.
 */
export async function codeFor(email: string, since: Date, timeoutMs = 30_000): Promise<string> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const res = await fetch(`${env.mailpitUrl}/api/v1/search?query=${encodeURIComponent(`to:"${email}"`)}`)
    if (!res.ok) throw new Error(`Mailpit search: ${res.status}`)
    const { messages } = (await res.json()) as { messages: Message[] }
    // Mailpit lists newest first; allow a second of clock skew between machines.
    const message = messages.find((m) => new Date(m.Created).getTime() >= since.getTime() - 1000)
    const code = message && (message.Snippet.match(/\b(\d{6})\b/)?.[1] ?? message.Subject.match(/\b(\d{6})\b/)?.[1])
    if (code) return code
    await new Promise((r) => setTimeout(r, 400))
  }
  throw new Error(`no code for ${email} in Mailpit after ${timeoutMs / 1000}s`)
}

/** Every email to `email` since `since`, newest first. */
export async function messagesFor(email: string, since: Date): Promise<Message[]> {
  const res = await fetch(`${env.mailpitUrl}/api/v1/search?query=${encodeURIComponent(`to:"${email}"`)}`)
  if (!res.ok) throw new Error(`Mailpit search: ${res.status}`)
  const { messages } = (await res.json()) as { messages: Message[] }
  return messages.filter((m) => new Date(m.Created).getTime() >= since.getTime() - 1000)
}

/** Whether Mailpit answers; checked once before the run. */
export async function mailpitUp() {
  return fetch(`${env.mailpitUrl}/api/v1/info`).then((r) => r.ok, () => false)
}
