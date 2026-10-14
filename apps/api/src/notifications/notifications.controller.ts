import { Body, Controller, Get, HttpCode, Inject, Post, Query, Req, UseGuards } from '@nestjs/common'
import { z } from 'zod'
import { type AuthedRequest, SessionGuard } from '../auth/session.guard.js'
import { paged, pageQuery, parse } from '../http.js'
import { NotificationsService } from './notifications.service.js'

const readBody = z.object({ upTo: z.uuid() })

@Controller('v1/notifications')
export class NotificationsController {
  constructor(@Inject(NotificationsService) private readonly notifications: NotificationsService) {}

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
}
