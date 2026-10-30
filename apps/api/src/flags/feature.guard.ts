import { type CanActivate, type ExecutionContext, Inject, Injectable, NotFoundException, SetMetadata } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import type { MaybeAuthedRequest } from '../auth/session.guard.js'
import { FeatureFlags } from './feature-flags.js'
import type { FlagKey } from './registry.js'

const FEATURE = 'heynaija:feature'

/**
 * Marks a route (or a whole controller) as part of a feature. Use it with
 * FeatureGuard, listed after the session guard so that the viewer is known:
 *
 *   @UseGuards(SessionGuard, FeatureGuard)
 *   @Feature('polls')
 */
export const Feature = (key: FlagKey) => SetMetadata(FEATURE, key)

/** While the route's flag is off for the viewer the route does not exist: 404, as for any dark launch. */
@Injectable()
export class FeatureGuard implements CanActivate {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(FeatureFlags) private readonly flags: FeatureFlags,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const key = this.reflector.getAllAndOverride<FlagKey | undefined>(FEATURE, [context.getHandler(), context.getClass()])
    if (!key) return true
    const viewer = context.switchToHttp().getRequest<MaybeAuthedRequest>().member?.id ?? null
    if (await this.flags.isEnabled(key, viewer)) return true
    throw new NotFoundException()
  }
}
