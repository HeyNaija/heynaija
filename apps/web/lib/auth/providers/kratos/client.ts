import 'server-only'
import { cookies, headers } from 'next/headers'
import { cache } from 'react'
import { redirect } from 'next/navigation'

// Server-to-server address of Ory Kratos. Browsers reach it through /kratos.
const KRATOS_URL = process.env.KRATOS_INTERNAL_URL ?? 'http://127.0.0.1:4533'

/** The Kratos session cookie (named in infra/kratos/kratos.yml). */
const SESSION_COOKIE = 'hn_session'

/** What the API needs to know who is asking: the session cookie, never the CSRF or invite ones. */
export async function getApiAuthHeaders(): Promise<Record<string, string>> {
  const session = (await cookies()).get(SESSION_COOKIE)?.value
  return session ? { cookie: `${SESSION_COOKIE}=${session}` } : {}
}

export async function hasSessionCredentials(): Promise<boolean> {
  return (await cookies()).has(SESSION_COOKIE)
}

export type FlowKind = 'login' | 'registration' | 'verification' | 'settings'

export type UiMessage = { id: number; text: string; type: 'info' | 'error' | 'success' }

export type UiNode = {
  type: 'input' | 'text' | 'a' | 'img' | 'script' | 'div'
  group: string
  attributes: {
    name?: string
    type?: string
    value?: unknown
    required?: boolean
    disabled?: boolean
    autocomplete?: string
    pattern?: string
    maxlength?: number
    href?: string
    title?: { text: string }
  }
  messages: UiMessage[]
  meta: { label?: { id: number; text: string } }
}

export type Flow = {
  id: string
  active?: string
  /** A login flow asking someone who is signed in to confirm it is them. */
  refresh?: boolean
  ui: { action: string; method: string; nodes: UiNode[]; messages?: UiMessage[] }
}

/** Where the browser goes to begin (or restart) a flow; Kratos redirects back with ?flow=. */
export const startFlowUrl = (kind: FlowKind) => `/kratos/self-service/${kind}/browser`

// The raw header, byte for byte: Kratos's anti-CSRF cookie is compared exactly, and
// re-serialising cookies would re-encode its value.
const cookieHeader = async () => (await headers()).get('cookie') ?? ''

/**
 * Loads the flow the browser was sent back with. A missing, expired or foreign
 * flow restarts it; Kratos decides where a signed-in or signed-out visitor goes.
 */
export async function getFlow(kind: FlowKind, id: string | string[] | undefined): Promise<Flow> {
  if (typeof id !== 'string') redirect(startFlowUrl(kind))

  const res = await fetch(`${KRATOS_URL}/self-service/${kind}/flows?id=${encodeURIComponent(id)}`, {
    headers: { cookie: await cookieHeader(), accept: 'application/json' },
    cache: 'no-store',
  })
  if ([400, 401, 403, 404, 410].includes(res.status)) redirect(startFlowUrl(kind))
  if (!res.ok) throw new Error(`Kratos ${kind} flow responded ${res.status}`)
  return res.json()
}

/**
 * The signed-in member's email, or null. Kratos leaves the address empty when it
 * asks someone to confirm it is them, although only that address will do.
 */
export const getSessionEmail = cache(async (): Promise<string | null> => {
  const res = await fetch(`${KRATOS_URL}/sessions/whoami`, {
    headers: { cookie: await cookieHeader(), accept: 'application/json' },
    cache: 'no-store',
  })
  if (!res.ok) return null
  const session = (await res.json()) as { identity?: { traits?: { email?: unknown } } }
  const email = session.identity?.traits?.email
  return typeof email === 'string' ? email : null
})

/** The URL that ends the current session, or null if there is none. */
export const getLogoutUrl = cache(async (): Promise<string | null> => {
  const res = await fetch(`${KRATOS_URL}/self-service/logout/browser`, {
    headers: { cookie: await cookieHeader(), accept: 'application/json' },
    cache: 'no-store',
  })
  if (!res.ok) return null
  const { logout_url } = (await res.json()) as { logout_url: string }
  // Kratos builds this from its public base URL, i.e. our own /kratos proxy.
  return new URL(logout_url).pathname + new URL(logout_url).search
})

export async function getFlowError(id: string): Promise<string | null> {
  const res = await fetch(`${KRATOS_URL}/self-service/errors?id=${encodeURIComponent(id)}`, {
    headers: { accept: 'application/json' },
    cache: 'no-store',
  })
  if (!res.ok) return null
  const body = (await res.json()) as { error?: { reason?: string; message?: string } }
  return body.error?.reason ?? body.error?.message ?? null
}
