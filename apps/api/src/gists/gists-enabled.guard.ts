import { type CanActivate, type ExecutionContext, Inject, Injectable, NotFoundException } from '@nestjs/common'
import type { FastifyRequest } from 'fastify'
import type { Env } from '../env.js'
import { ENV } from '../tokens.js'
import { canHostGist } from './eligibility.js'

/** Gists are live only with both switches on and LiveKit configured; empty settings mean off. */
export const gistsEnabled = (
  env: Pick<Env, 'CALLS_ENABLED' | 'CALLS_GISTS_ENABLED' | 'LIVEKIT_URL' | 'LIVEKIT_API_KEY' | 'LIVEKIT_API_SECRET'>,
): boolean =>
  env.CALLS_ENABLED && env.CALLS_GISTS_ENABLED && Boolean(env.LIVEKIT_URL && env.LIVEKIT_API_KEY && env.LIVEKIT_API_SECRET)

/** What Fastify answers for a route that does not exist, so a dark feature cannot be told from no feature. */
export const routeNotFound = (req: Pick<FastifyRequest, 'method' | 'url'>) => new NotFoundException(`Cannot ${req.method} ${req.url}`)

/**
 * First guard on every Gists route (before sign-in, so a signed-out caller
 * learns nothing either): with the flag off the route answers like a missing one.
 */
@Injectable()
export class GistsEnabledGuard implements CanActivate {
  constructor(@Inject(ENV) private readonly env: Parameters<typeof gistsEnabled>[0]) {}

  canActivate(context: ExecutionContext): boolean {
    if (gistsEnabled(this.env)) return true
    throw routeNotFound(context.switchToHttp().getRequest<FastifyRequest>())
  }
}

/**
 * What /v1/me tells the web app: Gists are shown only to a member who could use
 * them, so a build with the flag off, or any member off the allow-list, sees
 * nothing at all.
 */
export const gistsFeatureFor = (
  env: Parameters<typeof gistsEnabled>[0] & Pick<Env, 'CALLS_MEMBERS'>,
  member: { handle: string },
): boolean => gistsEnabled(env) && canHostGist({ id: '', handle: member.handle, active: true }, { callsMembers: env.CALLS_MEMBERS })
