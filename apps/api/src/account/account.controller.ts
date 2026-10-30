import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Header,
  HttpCode,
  Inject,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common'
import { z } from 'zod'
import { AuthService, authRequest } from '../auth/auth.service.js'
import { type AuthedRequest, SuspendedAllowedGuard } from '../auth/session.guard.js'
import type { Env } from '../env.js'
import { parse } from '../http.js'
import { RateLimiter } from '../rate-limit.js'
import { ENV } from '../tokens.js'
import { AccountDeletionError, AccountDeletionService } from './account-deletion.service.js'

/** Deleting an account needs a sign-in this recent, so a borrowed or forgotten session cannot. */
export const REAUTH_WINDOW_MS = 15 * 60_000

const deletionBody = z.object({ confirmHandle: z.string().max(40) })

/** `graceDays`: how long an account asked to be deleted now would wait before its erase. */
type DeletionView = { state: 'none'; graceDays: number } | { state: 'scheduled'; scheduledFor: string }

/**
 * A member deleting their own account (docs/adr/0016). Suspended members may
 * too, since suspension and deletion are separate, and a member waiting for
 * deletion is inactive until they cancel: hence SuspendedAllowedGuard.
 */
@Controller('v1/me/deletion')
@UseGuards(SuspendedAllowedGuard)
export class AccountController {
  constructor(
    @Inject(ENV) private readonly env: Pick<Env, 'ACCOUNT_DELETION_GRACE_DAYS'>,
    @Inject(AccountDeletionService) private readonly deletion: Pick<AccountDeletionService, 'state' | 'request' | 'cancel'>,
    @Inject(AuthService) private readonly auth: Pick<AuthService, 'authenticatedAtForRequest'>,
    @Inject(RateLimiter) private readonly limits: Pick<RateLimiter, 'hit'>,
  ) {}

  @Get()
  @Header('cache-control', 'no-store')
  async state(@Req() req: AuthedRequest): Promise<DeletionView> {
    const deletion = await this.deletion.state(req.member.id)
    return deletion.state === 'scheduled'
      ? { state: 'scheduled', scheduledFor: deletion.scheduledFor.toISOString() }
      : { state: 'none', graceDays: this.env.ACCOUNT_DELETION_GRACE_DAYS }
  }

  /** Asks for the erase. The member types their handle, and must have signed in within REAUTH_WINDOW_MS. */
  @Post()
  @HttpCode(200)
  @Header('cache-control', 'no-store')
  async request(@Req() req: AuthedRequest, @Body() body: unknown): Promise<DeletionView> {
    const { confirmHandle } = parse(deletionBody, body)
    await this.limits.hit('accountDeletion', req.member.id)
    if (confirmHandle.trim().replace(/^@/, '').toLowerCase() !== req.member.handle) {
      throw new BadRequestException({ code: 'handle_mismatch', message: 'Type your handle to confirm.' })
    }
    const signedInAt = await this.auth.authenticatedAtForRequest(authRequest(req))
    if (!signedInAt || Date.now() - signedInAt.getTime() > REAUTH_WINDOW_MS) {
      throw new ForbiddenException({ code: 'reauth_required', message: 'Sign in again to delete your account.' })
    }
    try {
      const { scheduledFor } = await this.deletion.request(req.member.id, { channel: 'self_service' })
      return { state: 'scheduled', scheduledFor: scheduledFor.toISOString() }
    } catch (err) {
      if (err instanceof AccountDeletionError && err.code === 'site_moderator') {
        throw new ForbiddenException({ code: err.code, message: err.message })
      }
      throw err
    }
  }

  /** Calls it off. Nothing to cancel is fine too; once the erase is due it is too late. */
  @Delete()
  @HttpCode(204)
  @Header('cache-control', 'no-store')
  async cancel(@Req() req: AuthedRequest): Promise<void> {
    await this.limits.hit('accountDeletion', req.member.id)
    try {
      await this.deletion.cancel(req.member.id)
    } catch (err) {
      if (err instanceof AccountDeletionError && err.code === 'too_late') {
        throw new ConflictException({ code: err.code, message: 'Your account is already being deleted.' })
      }
      throw err
    }
  }
}
