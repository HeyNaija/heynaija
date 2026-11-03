import { type CanActivate, type ExecutionContext, Inject, Injectable } from '@nestjs/common'
import type { FastifyRequest } from 'fastify'
import type { Env } from '../../env.js'
import { routeNotFound } from '../../http.js'
import { ENV } from '../../tokens.js'

type GamesEnv = Pick<Env, 'GAMES_ENABLED' | 'GAMES_MEMBERS'>

/** The site-wide switch. */
export const gamesEnabled = (env: Pick<Env, 'GAMES_ENABLED'>): boolean => env.GAMES_ENABLED

/**
 * The one place that decides whether a member may see Games: the switch is on
 * and their handle is on GAMES_MEMBERS. Suspended members never get this far,
 * since every caller sits behind SessionGuard. Do not add a second check elsewhere.
 */
export const gamesFeatureFor = (env: GamesEnv, member: { handle: string }): boolean =>
  gamesEnabled(env) && env.GAMES_MEMBERS.includes(member.handle.toLowerCase())

/**
 * First guard on every Games route (before sign-in, so a signed-out caller learns
 * nothing either): with the switch off the route answers like a missing one.
 */
@Injectable()
export class GamesEnabledGuard implements CanActivate {
  constructor(@Inject(ENV) private readonly env: Pick<Env, 'GAMES_ENABLED'>) {}

  canActivate(context: ExecutionContext): boolean {
    if (gamesEnabled(this.env)) return true
    throw routeNotFound(context.switchToHttp().getRequest<FastifyRequest>())
  }
}
