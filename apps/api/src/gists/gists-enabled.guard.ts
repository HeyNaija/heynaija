import { type CanActivate, type ExecutionContext, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common'
import type { FastifyRequest } from 'fastify'
import type { MaybeAuthedRequest } from '../auth/session.guard.js'
import type { AppEnv, Env } from '../env.js'
import { FeatureFlags, type FlagReading } from '../flags/feature-flags.js'
import type { AgeStatus } from '../governance/age.js'
import { ENV } from '../tokens.js'
import { canHostGist, canJoinGist } from './eligibility.js'

type LiveKitEnv = Pick<Env, 'LIVEKIT_URL' | 'LIVEKIT_API_KEY' | 'LIVEKIT_API_SECRET'>

/** Without a LiveKit server there is nothing for the flag to switch on; empty settings mean none. */
export const livekitConfigured = (env: LiveKitEnv): boolean => Boolean(env.LIVEKIT_URL && env.LIVEKIT_API_KEY && env.LIVEKIT_API_SECRET)

/** Who Gists are open to, read once. Being signed in and active is checked by the caller (eligibility.ts). */
export type GistsAccess = {
  member: (memberId: string) => boolean
  /** Open to somebody, so a signed-out visitor is asked to sign in rather than shown nothing. */
  anyone: boolean
}

const CLOSED: GistsAccess = { member: () => false, anyone: false }

/**
 * The `gists` flag (docs/feature-flags.md) as it takes effect: nobody without
 * LiveKit, and in production only the members on the flag's allow-list, never
 * everyone. That last part is ADR 0017's temporary gate, held in code because an
 * admin can flip a flag: until the age check exists (eligibility.ts), production
 * has Gists for a named list of members or not at all.
 */
export function gistsAccess(flag: FlagReading, livekit: boolean, appEnv: AppEnv): GistsAccess {
  if (!livekit || (appEnv === 'production' && !flag.listed)) return CLOSED
  return { member: (memberId) => flag.isEnabled(memberId), anyone: flag.listed || flag.isEnabled(null) }
}

/** Asked by the route guard, by /v1/me and by every eligibility check in GistsService. */
@Injectable()
export class GistsGate {
  private readonly log = new Logger(GistsGate.name)

  constructor(
    @Inject(FeatureFlags) private readonly flags: FeatureFlags,
    @Inject(ENV) private readonly env: LiveKitEnv & Pick<Env, 'APP_ENV'>,
  ) {}

  /** Closed to everyone whenever it cannot be sure. */
  async access(): Promise<GistsAccess> {
    if (!livekitConfigured(this.env)) return CLOSED
    try {
      return gistsAccess(await this.flags.reading('gists'), true, this.env.APP_ENV)
    } catch (err) {
      this.log.error(`could not decide gists; treating it as off: ${(err as Error).message}`)
      return CLOSED
    }
  }
}

/**
 * What /v1/me tells the web app: Gists are shown only to a member who could join
 * one, decided by the same check as everything else (eligibility.ts).
 */
export const gistsShownTo = (access: GistsAccess, member: { id: string; handle: string }): boolean =>
  canJoinGist({ ...member, active: true }, { status: 'live', communityId: null }, { allowed: access.member, inCommunity: false })

/** And whether they may host and speak too, or only listen: the stage's check (eligibility.ts). */
export const gistStageFor = (access: GistsAccess, member: { id: string; handle: string }, age: AgeStatus): boolean =>
  canHostGist({ ...member, active: true, age }, { allowed: access.member })

/** What Fastify answers for a route that does not exist, so a dark feature cannot be told from no feature. */
export const routeNotFound = (req: Pick<FastifyRequest, 'method' | 'url'>) => new NotFoundException(`Cannot ${req.method} ${req.url}`)

/**
 * On every Gists route, after OptionalSessionGuard (so the allow-list can see the
 * viewer) and before SessionGuard (so a signed-out caller learns nothing either):
 * for a member Gists are not open to, the route answers like a missing one. A
 * signed-out caller gets through, to SessionGuard's 401, only while Gists are open
 * to somebody.
 */
@Injectable()
export class GistsEnabledGuard implements CanActivate {
  constructor(@Inject(GistsGate) private readonly gate: Pick<GistsGate, 'access'>) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<MaybeAuthedRequest>()
    const access = await this.gate.access()
    if (req.member ? access.member(req.member.id) : access.anyone) return true
    throw routeNotFound(req)
  }
}

/**
 * On LiveKit's webhook, which carries no member: it answers while LiveKit is
 * configured, whatever the flag says, so Gists already live are still wound down
 * after the flag goes off.
 */
@Injectable()
export class LiveKitConfiguredGuard implements CanActivate {
  constructor(@Inject(ENV) private readonly env: LiveKitEnv) {}

  canActivate(context: ExecutionContext): boolean {
    if (livekitConfigured(this.env)) return true
    throw routeNotFound(context.switchToHttp().getRequest<FastifyRequest>())
  }
}
