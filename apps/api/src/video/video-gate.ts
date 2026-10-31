import { type CanActivate, type ExecutionContext, Inject, Injectable, Logger } from '@nestjs/common'
import type { MaybeAuthedRequest } from '../auth/session.guard.js'
import type { AppEnv, Env } from '../env.js'
import { FeatureFlags } from '../flags/feature-flags.js'
import { routeNotFound } from '../gists/gists-enabled.guard.js'
import { CONTENT_SCANNER, type ContentScanner, NoScanner } from '../media/media.service.js'
import { ENV } from '../tokens.js'

/**
 * `videoPosts` is effective only when the flag is on AND (a real scanner is bound
 * OR this is not production). ADR 0019 section 4.7: an admin can flip a flag in
 * the database, so the rule that no video is accepted in production without an
 * upload scanner is enforced here, in code.
 */
export const videoPostsEffective = (flagOn: boolean, scannerBound: boolean, appEnv: AppEnv): boolean =>
  flagOn && (scannerBound || appEnv !== 'production')

export const scannerIsBound = (scanner: ContentScanner): boolean => !(scanner instanceof NoScanner)

/** Asked by the guard, by /v1/me and by the post-create path: one answer to "may this member use video?". */
@Injectable()
export class VideoGate {
  private readonly log = new Logger(VideoGate.name)

  constructor(
    @Inject(FeatureFlags) private readonly flags: FeatureFlags,
    @Inject(ENV) private readonly env: Pick<Env, 'APP_ENV'>,
    @Inject(CONTENT_SCANNER) private readonly scanner: ContentScanner,
  ) {}

  /** False whenever it cannot be sure. */
  async isOpen(viewerId: string | null): Promise<boolean> {
    try {
      return this.effective(await this.flags.isEnabled('videoPosts', viewerId))
    } catch (err) {
      this.log.error(`could not decide videoPosts; treating it as off: ${(err as Error).message}`)
      return false
    }
  }

  /** For /v1/me, which already holds the viewer's raw flag value. */
  effective(flagOn: boolean): boolean {
    return videoPostsEffective(flagOn, scannerIsBound(this.scanner), this.env.APP_ENV)
  }
}

/**
 * First guard on every video route after OptionalSessionGuard (so an allow-list
 * can see the viewer) and before SessionGuard (so a signed-out caller learns
 * nothing either): while video is closed the route answers like one that does
 * not exist, the same as the Gists gate.
 */
@Injectable()
export class VideoPostsGuard implements CanActivate {
  constructor(@Inject(VideoGate) private readonly gate: VideoGate) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<MaybeAuthedRequest>()
    if (await this.gate.isOpen(req.member?.id ?? null)) return true
    throw routeNotFound(req)
  }
}
