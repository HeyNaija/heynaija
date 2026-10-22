import { Inject, Injectable } from '@nestjs/common'
import { z } from 'zod'
import type { Env } from '../env.js'
import { ENV } from '../tokens.js'
import { AuthProviderError } from './auth-session.provider.js'
import type { AuthFlowKind, AuthFlowProvider, AuthFlowRequest, AuthInteraction, AuthRedirect } from './auth-flow.provider.js'

const flowSchema = z.object({
  id: z.string(),
  ui: z.object({
    action: z.string(), method: z.string(),
    nodes: z.array(z.object({ type: z.string(), group: z.string(), attributes: z.record(z.string(), z.unknown()) }).passthrough()),
  }).passthrough(),
}).passthrough()
const pages = { login: 'login', registration: 'signup', verification: 'verification', settings: 'settings' }

@Injectable()
export class KratosFlowProvider implements AuthFlowProvider {
  constructor(@Inject(ENV) private readonly env: Pick<Env, 'KRATOS_PUBLIC_URL' | 'WEB_PUBLIC_URL' | 'AUTH_EXTERNAL_REDIRECT_ORIGINS'>) {}

  async begin(kind: AuthFlowKind, request: AuthFlowRequest): Promise<AuthRedirect> {
    return this.browser(await this.call(`/self-service/${kind}/browser`, request), kind)
  }

  async reauthenticate(request: AuthFlowRequest): Promise<AuthRedirect> {
    return this.browser(await this.call('/self-service/login/browser?refresh=true', request), 'login')
  }

  async resume(kind: AuthFlowKind, id: string, request: AuthFlowRequest): Promise<AuthInteraction> {
    const response = await this.call(`/self-service/${kind}/flows?id=${encodeURIComponent(id)}`, request, { headers: { accept: 'application/json' } })
    if ([400, 401, 403, 404, 410].includes(response.status)) {
      return { kind: 'redirect', location: `/api/v1/auth/flows/${kind}/start`, cookies: [] }
    }
    if (!response.ok) throw new AuthProviderError('unavailable')
    const parsed = flowSchema.safeParse(await this.json(response))
    if (!parsed.success || parsed.data.id !== id || parsed.data.ui.method.toUpperCase() !== 'POST') throw new AuthProviderError('protocol')
    // Never accept a provider-returned arbitrary submission URL. The API builds it.
    const action = this.url(parsed.data.ui.action)
    if (action.origin !== new URL(this.env.WEB_PUBLIC_URL).origin ||
        action.pathname !== `/kratos/self-service/${kind}`) {
      throw new AuthProviderError('protocol')
    }
    parsed.data.ui.action = `/api/v1/auth/flows/${kind}?flow=${encodeURIComponent(id)}`
    return { kind: 'form', providerKind: 'kratos', form: parsed.data }
  }

  async submit(kind: AuthFlowKind, id: string, form: string, request: AuthFlowRequest): Promise<AuthRedirect> {
    return this.browser(await this.call(`/self-service/${kind}?flow=${encodeURIComponent(id)}`, request, {
      method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: form,
    }), kind, id)
  }

  async logoutUrl(request: AuthFlowRequest): Promise<string | null> {
    const response = await this.call('/self-service/logout/browser', request, { headers: { accept: 'application/json' } })
    if ([401, 403].includes(response.status)) return null
    if (!response.ok) throw new AuthProviderError('unavailable')
    const body = z.object({ logout_url: z.string() }).safeParse(await this.json(response))
    if (!body.success) throw new AuthProviderError('protocol')
    const url = this.url(body.data.logout_url)
    if (url.origin !== new URL(this.env.WEB_PUBLIC_URL).origin || url.pathname !== '/kratos/self-service/logout') throw new AuthProviderError('protocol')
    const token = url.searchParams.get('token')
    if (!token) throw new AuthProviderError('protocol')
    return `/api/v1/auth/logout?token=${encodeURIComponent(token)}`
  }

  async logout(token: string, request: AuthFlowRequest): Promise<AuthRedirect> {
    return this.browser(await this.call(`/self-service/logout?token=${encodeURIComponent(token)}`, request))
  }

  async error(id: string): Promise<string | null> {
    const response = await this.call(`/self-service/errors?id=${encodeURIComponent(id)}`, {}, { headers: { accept: 'application/json' } })
    if (response.status === 404) return null
    if (!response.ok) throw new AuthProviderError('unavailable')
    const body = z.object({ error: z.object({ reason: z.string().optional(), message: z.string().optional() }).optional() }).safeParse(await this.json(response))
    if (!body.success) throw new AuthProviderError('protocol')
    return body.data.error?.reason ?? body.data.error?.message ?? null
  }

  private async call(path: string, request: AuthFlowRequest, init: RequestInit = {}): Promise<Response> {
    try {
      return await fetch(`${this.env.KRATOS_PUBLIC_URL}${path}`, {
        ...init, redirect: 'manual', signal: AbortSignal.timeout(10_000),
        headers: { accept: 'text/html', ...init.headers,
          ...(request.cookieHeader ? { cookie: request.cookieHeader } : {}),
          ...(request.origin ? { origin: request.origin } : {}),
        },
      })
    } catch { throw new AuthProviderError('unavailable') }
  }

  private async json(response: Response): Promise<unknown> {
    try { return await response.json() } catch { throw new AuthProviderError('protocol') }
  }

  private url(value: string): URL {
    try { return new URL(value, this.env.WEB_PUBLIC_URL) } catch { throw new AuthProviderError('protocol') }
  }

  private async browser(response: Response, kind?: AuthFlowKind, id?: string): Promise<AuthRedirect> {
    const cookies = response.headers.getSetCookie()
    if (kind && response.status === 410) {
      return { kind: 'redirect', location: `/api/v1/auth/flows/${kind}/start`, cookies }
    }
    const location = response.headers.get('location')
    if ([302, 303].includes(response.status) && location) {
      const url = this.url(location)
      const local = url.origin === new URL(this.env.WEB_PUBLIC_URL).origin
      const path = url.pathname + url.search + url.hash
      const external = this.env.AUTH_EXTERNAL_REDIRECT_ORIGINS.includes(url.origin)
      if (local && path.startsWith('//')) throw new AuthProviderError('protocol')
      if ((!local && !external) || url.username || url.password) throw new AuthProviderError('protocol')
      return { kind: 'redirect', location: local ? path : url.href, cookies }
    }
    // Some provider responses carry validation messages as a flow rather than a
    // redirect. Reload that same flow so the normal renderer displays the errors.
    if (kind && id && [200, 400].includes(response.status)) {
      const parsed = flowSchema.safeParse(await this.json(response))
      if (parsed.success && parsed.data.id === id) {
        return { kind: 'redirect', location: `/${pages[kind]}?flow=${encodeURIComponent(id)}`, cookies }
      }
    }
    throw new AuthProviderError(response.status >= 500 ? 'unavailable' : 'protocol')
  }
}
