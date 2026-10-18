import { BadRequestException, Controller, Get, HttpCode, Inject, Param, Post, Res } from '@nestjs/common'
import type { FastifyReply } from 'fastify'
import { EmailNotificationsService } from './email-notifications.service.js'

/**
 * Where the link in every notification email leads. Neither route needs a login:
 * the signed token in the address is the permission, and all it can do is turn
 * that member's email notifications off.
 */
@Controller('v1/email')
export class EmailController {
  constructor(@Inject(EmailNotificationsService) private readonly email: EmailNotificationsService) {}

  /**
   * The link in the body of an email: turns email off at once and sends the
   * browser to a page that says so. Relative, so the browser stays on the origin it used.
   */
  @Get('unsubscribe/:token')
  async link(@Param('token') token: string, @Res({ passthrough: true }) reply: FastifyReply): Promise<void> {
    const done = await this.email.unsubscribe(token)
    void reply.status(303).header('location', done ? '/email-off' : '/email-off?link=invalid')
  }

  /** The one-click unsubscribe of RFC 8058, which a mail program POSTs to without opening anything. */
  @Post('unsubscribe/:token')
  @HttpCode(204)
  async oneClick(@Param('token') token: string): Promise<void> {
    if (!(await this.email.unsubscribe(token))) throw new BadRequestException('not a valid unsubscribe link')
  }
}
