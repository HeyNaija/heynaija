import { BadRequestException, Controller, Get, HttpCode, Inject, Param, Post, Res } from '@nestjs/common'
import type { FastifyReply } from 'fastify'
import { HighlightsService } from './highlights.service.js'

/**
 * The public side of weekly highlights (ADR 0027): the rules they are chosen
 * by, and where the link in a highlights email leads. None of it needs a login.
 */
@Controller('v1/highlights')
export class HighlightsController {
  constructor(@Inject(HighlightsService) private readonly highlights: HighlightsService) {}

  /** The rules as the code applies them, for /about/highlights, and whether highlights are being sent yet. */
  @Get('rules')
  rules() {
    return this.highlights.rules()
  }

  /**
   * The link in the body of the email: turns weekly highlights off at once and
   * sends the browser to a page that says so. The signed token in the address is
   * the permission, and that is all it can do. Relative, so the browser stays on
   * the origin it used.
   */
  @Get('unsubscribe/:token')
  async link(@Param('token') token: string, @Res({ passthrough: true }) reply: FastifyReply): Promise<void> {
    const done = await this.highlights.unsubscribe(token)
    void reply.status(303).header('location', done ? '/email-off?what=highlights' : '/email-off?what=highlights&link=invalid')
  }

  /** The one-click unsubscribe of RFC 8058, which a mail program POSTs to without opening anything. */
  @Post('unsubscribe/:token')
  @HttpCode(204)
  async oneClick(@Param('token') token: string): Promise<void> {
    if (!(await this.highlights.unsubscribe(token))) throw new BadRequestException('not a valid unsubscribe link')
  }
}
