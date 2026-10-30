import { type CanActivate, type ExecutionContext, Inject, Injectable, NotFoundException } from '@nestjs/common'
import type { FastifyRequest } from 'fastify'
import type { Env } from '../env.js'
import { ENV } from '../tokens.js'
import { canHostSpace } from './eligibility.js'

/** Spaces are live only with both switches on and LiveKit configured; empty settings mean off. */
export const spacesEnabled = (
  env: Pick<Env, 'CALLS_ENABLED' | 'CALLS_SPACES_ENABLED' | 'LIVEKIT_URL' | 'LIVEKIT_API_KEY' | 'LIVEKIT_API_SECRET'>,
): boolean =>
  env.CALLS_ENABLED && env.CALLS_SPACES_ENABLED && Boolean(env.LIVEKIT_URL && env.LIVEKIT_API_KEY && env.LIVEKIT_API_SECRET)

/** What Fastify answers for a route that does not exist, so a dark feature cannot be told from no feature. */
export const routeNotFound = (req: Pick<FastifyRequest, 'method' | 'url'>) => new NotFoundException(`Cannot ${req.method} ${req.url}`)

/**
 * First guard on every Spaces route (before sign-in, so a signed-out caller
 * learns nothing either): with the flag off the route answers like a missing one.
 */
@Injectable()
export class SpacesEnabledGuard implements CanActivate {
  constructor(@Inject(ENV) private readonly env: Parameters<typeof spacesEnabled>[0]) {}

  canActivate(context: ExecutionContext): boolean {
    if (spacesEnabled(this.env)) return true
    throw routeNotFound(context.switchToHttp().getRequest<FastifyRequest>())
  }
}

/**
 * What /v1/me tells the web app: Spaces are shown only to a member who could use
 * them, so a build with the flag off, or any member off the allow-list, sees
 * nothing at all.
 */
export const spacesFeatureFor = (
  env: Parameters<typeof spacesEnabled>[0] & Pick<Env, 'CALLS_MEMBERS'>,
  member: { handle: string },
): boolean => spacesEnabled(env) && canHostSpace({ id: '', handle: member.handle, active: true }, { callsMembers: env.CALLS_MEMBERS })
