import { type Db, members } from '@heynaija/db'
import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  HttpException,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common'
import type {} from '@fastify/cookie' // request.cookies typings
import { eq } from 'drizzle-orm'
import type { FastifyRequest } from 'fastify'
import type { Env } from '../env.js'
import { InvitesService } from '../invites/invites.service.js'
import { DB, ENV } from '../tokens.js'
import { type Identity, KratosService, SESSION_COOKIE } from './kratos.service.js'

export type AuthedRequest = FastifyRequest & { member: Identity }
export type MaybeAuthedRequest = FastifyRequest & { member?: Identity }

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

@Injectable()
export class SessionGuard implements CanActivate {
  /** Suspended members are turned away, except where a subclass says otherwise. */
  protected readonly requireActive: boolean = true

  constructor(
    @Inject(KratosService) private readonly kratos: Pick<KratosService, 'identityForSession'>,
    @Inject(ENV) private readonly env: Pick<Env, 'WEB_PUBLIC_URL'>,
    @Inject(DB) private readonly db: Db,
    @Inject(InvitesService) private readonly invites: Pick<InvitesService, 'hasRedeemed'>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<AuthedRequest>()

    // CSRF: a browser always sends Origin on cross-site writes; reject foreign ones.
    const origin = req.headers.origin
    if (!SAFE_METHODS.has(req.method) && origin && origin !== new URL(this.env.WEB_PUBLIC_URL).origin) {
      throw new ForbiddenException('cross-origin write rejected')
    }

    const cookie = req.cookies[SESSION_COOKIE]
    const identity = cookie ? await this.kratos.identityForSession(cookie) : null
    if (!identity) throw new UnauthorizedException('sign in required')

    let [member] = await this.db
      .update(members)
      .set({ handle: identity.handle, lastSeenAt: new Date() })
      .where(eq(members.id, identity.id))
      .returning({ active: members.active })

    if (!member) {
      // First sight of this identity. A Kratos account alone is not membership:
      // it must have come in through an invite.
      if (!(await this.invites.hasRedeemed(identity.id))) {
        throw new ForbiddenException('invite_required')
      }
      ;[member] = await this.db
        .insert(members)
        .values({ id: identity.id, handle: identity.handle, lastSeenAt: new Date() })
        .onConflictDoUpdate({ target: members.id, set: { lastSeenAt: new Date() } })
        .returning({ active: members.active })
    }
    if (!member) throw new ForbiddenException('account_inactive')
    if (!member.active && this.requireActive) throw new ForbiddenException('account_inactive')

    req.member = identity
    return true
  }
}

/**
 * For public reads that are personalised when someone is signed in (has the
 * viewer liked this, do they follow that member). Anyone the full guard would
 * turn away is simply treated as anonymous. Never use this on a write.
 */
@Injectable()
export class OptionalSessionGuard extends SessionGuard {
  override async canActivate(context: ExecutionContext): Promise<boolean> {
    try {
      return await super.canActivate(context)
    } catch (err) {
      if (err instanceof HttpException) return true
      throw err
    }
  }
}

/**
 * Lets a suspended member through. Only for the one thing they are still allowed
 * to do: appeal.
 */
@Injectable()
export class SuspendedAllowedGuard extends SessionGuard {
  protected override readonly requireActive = false
}
