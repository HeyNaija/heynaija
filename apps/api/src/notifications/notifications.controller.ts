import { OPTIONAL_NOTIFICATION_KINDS } from '@heynaija/db'
import { BadRequestException, Body, Controller, Get, HttpCode, Inject, Post, Put, Query, Req, UseGuards } from '@nestjs/common'
import { z } from 'zod'
import { type AuthedRequest, SessionGuard } from '../auth/session.guard.js'
import { paged, pageQuery, parse } from '../http.js'
import { RateLimiter } from '../rate-limit.js'
import { NotificationsService, NotOptionalError, type OptionalNotificationKind } from './notifications.service.js'

const readBody = z.object({ upTo: z.uuid() })

// Each kind a member may turn off, true for on. Any other key, including a
// moderation or account notice, is refused.
const preferencesBody = z.strictObject(
  Object.fromEntries(OPTIONAL_NOTIFICATION_KINDS.map((kind) => [kind, z.boolean().optional()])) as Record<
    OptionalNotificationKind,
    z.ZodOptional<z.ZodBoolean>
  >,
)

@Controller('v1/notifications')
export class NotificationsController {
  constructor(
    @Inject(NotificationsService) private readonly notifications: NotificationsService,
    @Inject(RateLimiter) private readonly limits: RateLimiter,
  ) {}

  @Get()
  @UseGuards(SessionGuard)
  list(@Req() req: AuthedRequest, @Query() query: unknown) {
    const { limit, cursor } = parse(pageQuery, query)
    return paged(() => this.notifications.list(req.member.id, limit, cursor))
  }

  /** Marks everything up to the newest notification the member has seen as read. */
  @Post('read')
  @HttpCode(204)
  @UseGuards(SessionGuard)
  async read(@Req() req: AuthedRequest, @Body() body: unknown) {
    const { upTo } = parse(readBody, body)
    await this.notifications.markRead(req.member.id, upTo)
  }

  /** Which kinds of activity the member is notified about. */
  @Get('preferences')
  @UseGuards(SessionGuard)
  preferences(@Req() req: AuthedRequest) {
    return this.notifications.preferences(req.member.id)
  }

  /** Turns kinds on or off; kinds left out stay as they are. Answers with the result. */
  @Put('preferences')
  @UseGuards(SessionGuard)
  async setPreferences(@Req() req: AuthedRequest, @Body() body: unknown) {
    const changes = parse(preferencesBody, body)
    await this.limits.hit('action', req.member.id)
    try {
      return await this.notifications.setPreferences(req.member.id, changes)
    } catch (err) {
      if (err instanceof NotOptionalError) throw new BadRequestException(err.message)
      throw err
    }
  }
}
