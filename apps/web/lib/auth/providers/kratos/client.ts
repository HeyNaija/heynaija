import 'server-only'
import { cookies, headers } from 'next/headers'
import { cache } from 'react'
import { redirect } from 'next/navigation'

// Flow operations go through the application API; the renderer stays provider-specific.
const API_URL = process.env.API_INTERNAL_URL ?? 'http://127.0.0.1:4000'
const SESSION_COOKIE = 'hn_session'

/** Forward only the session credential to the API, never invite/CSRF cookies. */
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
export const startFlowUrl = (kind: FlowKind) => `/api/v1/auth/flows/${kind}/start`

// The raw header, byte for byte: Kratos's anti-CSRF cookie is compared exactly, and
// re-serialising cookies would re-encode its value.
const cookieHeader = async () => (await headers()).get('cookie') ?? ''

/**
 * Loads the flow the browser was sent back with. A missing, expired or foreign
 * flow restarts it; Kratos decides where a signed-in or signed-out visitor goes.
 */
export async function getFlow(kind: FlowKind, id: string | string[] | undefined): Promise<Flow> {
  if (typeof id !== 'string') redirect(startFlowUrl(kind))

  const res = await fetch(`${API_URL}/v1/auth/flows/${kind}?flow=${encodeURIComponent(id)}`, {
    headers: { cookie: await cookieHeader(), accept: 'application/json' },
    cache: 'no-store',
  })
  if ([400, 401, 403, 404, 410].includes(res.status)) redirect(startFlowUrl(kind))
  if (!res.ok) throw new Error(`Kratos ${kind} flow responded ${res.status}`)
  const interaction = await res.json() as { kind: 'redirect'; location: string } | { kind: 'form'; providerKind: string; form: Flow }
  if (interaction.kind === 'redirect') redirect(interaction.location)
  if (interaction.kind !== 'form' || interaction.providerKind !== 'kratos') throw new Error('Unsupported authentication interaction')
  return interaction.form
}

/**
 * The signed-in member's email, or null. Kratos leaves the address empty when it
 * asks someone to confirm it is them, although only that address will do.
 */
export const getSessionEmail = cache(async (): Promise<string | null> => {
  const res = await fetch(`${API_URL}/v1/auth/account/email`, {
    headers: { cookie: await cookieHeader(), accept: 'application/json' },
    cache: 'no-store',
  })
  if (!res.ok) return null
  const account = (await res.json()) as { email?: unknown }
  const email = account.email
  return typeof email === 'string' ? email : null
})

/** The URL that ends the current session, or null if there is none. */
export const getLogoutUrl = cache(async (): Promise<string | null> => {
  const res = await fetch(`${API_URL}/v1/auth/logout/link`, {
    headers: { cookie: await cookieHeader(), accept: 'application/json' },
    cache: 'no-store',
  })
  if (!res.ok) return null
  const { url } = (await res.json()) as { url: string | null }
  return url
})

export async function getFlowError(id: string): Promise<string | null> {
  const res = await fetch(`${API_URL}/v1/auth/errors?id=${encodeURIComponent(id)}`, {
    headers: { cookie: await cookieHeader(), accept: 'application/json' },
    cache: 'no-store',
  })
  if (!res.ok) return null
  const body = (await res.json()) as { message: string | null }
  return body.message
}
