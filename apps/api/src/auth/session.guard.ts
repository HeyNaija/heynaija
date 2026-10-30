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
import { eq } from 'drizzle-orm'
import type { FastifyRequest } from 'fastify'
import type { Env } from '../env.js'
import { InvitesService } from '../invites/invites.service.js'
import { DB, ENV } from '../tokens.js'
import { AuthService, authRequest, type MemberIdentity } from './auth.service.js'

export type AuthedRequest = FastifyRequest & { member: MemberIdentity }
export type MaybeAuthedRequest = FastifyRequest & { member?: MemberIdentity }

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

/** `members.last_seen_at` is refreshed at most this often per member. */
export const LAST_SEEN_EVERY_MS = 5 * 60_000

@Injectable()
export class SessionGuard implements CanActivate {
  /** Suspended members are turned away, except where a subclass says otherwise. */
  protected readonly requireActive: boolean = true

  constructor(
    @Inject(AuthService) private readonly auth: Pick<AuthService, 'identityForRequest'>,
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

    const identity = await this.auth.identityForRequest(authRequest(req))
    if (!identity) throw new UnauthorizedException('sign in required')

    // A plain primary-key read on every request: `active` is never cached, so a
    // suspension takes effect on the member's very next request.
    let [member] = await this.db
      .select({
        active: members.active,
        handle: members.handle,
        lastSeenAt: members.lastSeenAt,
        deletionRequestedAt: members.deletionRequestedAt,
        deletedAt: members.deletedAt,
      })
      .from(members)
      .where(eq(members.id, identity.id))

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
        .returning({
          active: members.active,
          handle: members.handle,
          lastSeenAt: members.lastSeenAt,
          deletionRequestedAt: members.deletionRequestedAt,
          deletedAt: members.deletedAt,
        })
    } else if (
      // Once deletion is asked for, the row is left alone: the erase holds the
      // handle it has and then blanks it, and a cached session must not write
      // the old one back (docs/adr/0016).
      !member.deletionRequestedAt &&
      (member.handle !== identity.handle ||
        !member.lastSeenAt ||
        Date.now() - member.lastSeenAt.getTime() >= LAST_SEEN_EVERY_MS)
    ) {
      // Writing last_seen_at on every call meant 3–5 row updates per page view;
      // "last seen" only needs to be right to within a few minutes.
      await this.db
        .update(members)
        .set({ handle: identity.handle, lastSeenAt: new Date() })
        .where(eq(members.id, identity.id))
    }
    if (!member) throw new ForbiddenException('account_inactive')
    // An erased account is no account, even to a session Kratos has not yet forgotten.
    if (member.deletedAt) throw new ForbiddenException('account_inactive')
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
 * Lets an inactive member through: one who is suspended, or waiting for their
 * account's deletion. Only for what they may still do: appeal, download their
 * data, stop push on a device, and ask for or cancel the deletion. An erased
 * account is still refused.
 */
@Injectable()
export class SuspendedAllowedGuard extends SessionGuard {
  protected override readonly requireActive = false
}
