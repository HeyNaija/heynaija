import { type CanActivate, type ExecutionContext, Inject, Injectable } from '@nestjs/common'
import type { FastifyRequest } from 'fastify'
import type { Env } from '../env.js'
import { routeNotFound, gistsEnabled } from '../gists/gists-enabled.guard.js'
import { ENV } from '../tokens.js'
import { isAgeVerifiedAdult } from './can-call.js'

type CallsEnv = Pick<Env, 'CALLS_ENABLED' | 'LIVEKIT_URL' | 'LIVEKIT_API_KEY' | 'LIVEKIT_API_SECRET'>

/** 1:1 calls are live only with CALLS_ENABLED on and LiveKit configured; empty settings mean off. */
export const callsEnabled = (env: CallsEnv): boolean =>
  env.CALLS_ENABLED && Boolean(env.LIVEKIT_URL && env.LIVEKIT_API_KEY && env.LIVEKIT_API_SECRET)

/** First guard on every calls route (before sign-in): with the flag off it answers like a missing route. */
@Injectable()
export class CallsEnabledGuard implements CanActivate {
  constructor(@Inject(ENV) private readonly env: CallsEnv) {}

  canActivate(context: ExecutionContext): boolean {
    if (callsEnabled(this.env)) return true
    throw routeNotFound(context.switchToHttp().getRequest<FastifyRequest>())
  }
}

/** The LiveKit webhook is shared by Gists and calls, so it is live when either is. */
@Injectable()
export class LiveKitWebhookGuard implements CanActivate {
  constructor(@Inject(ENV) private readonly env: CallsEnv & Parameters<typeof gistsEnabled>[0]) {}

  canActivate(context: ExecutionContext): boolean {
    if (callsEnabled(this.env) || gistsEnabled(this.env)) return true
    throw routeNotFound(context.switchToHttp().getRequest<FastifyRequest>())
  }
}

/**
 * What /v1/me tells the web app: calls are shown only to a member who could use
 * them. A member off the allow-list, or any member while the flag is off, sees nothing.
 * (The per-call checks in `canCall` still run on live data.)
 */
export const callsFeatureFor = (env: CallsEnv & Pick<Env, 'CALLS_MEMBERS'>, member: { handle: string }): boolean =>
  callsEnabled(env) && isAgeVerifiedAdult(member, { callsMembers: env.CALLS_MEMBERS })
