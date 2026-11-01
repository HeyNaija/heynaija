import { REPORT_REASONS } from '@heynaija/db'
import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common'
import { z } from 'zod'
import { type AuthedRequest, SessionGuard, SuspendedAllowedGuard } from '../auth/session.guard.js'
import { handleParam, parse, slugParam } from '../http.js'
import { RateLimiter } from '../rate-limit.js'
import { ModerationService, ModerationTargetError, NotAModeratorError, RESOLUTIONS } from './moderation.service.js'

const reasons = REPORT_REASONS.filter((r) => r !== 'appeal')
const details = z.string().trim().max(500).default('')
const note = z.object({ note: z.string().trim().max(500).default('') })

const reportBody = z.union([
  z.object({ postId: z.uuid(), reason: z.enum(reasons), details }),
  z.object({ handle: handleParam, reason: z.enum(reasons), details }),
  z.object({ gistId: z.uuid(), reason: z.enum(reasons), details }),
  z.object({ communitySlug: slugParam, reason: z.enum(reasons), details }),
])
const appealBody = z.object({ message: z.string().trim().min(10).max(1000) })
const resolveBody = note.extend({ resolution: z.enum(RESOLUTIONS) })

/** Maps the service's refusals onto HTTP: not allowed is 403, cannot be done is 400. */
async function guarded<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run()
  } catch (err) {
    if (err instanceof NotAModeratorError) throw new ForbiddenException()
    if (err instanceof ModerationTargetError) throw new BadRequestException(err.message)
    throw err
  }
}

@Controller('v1')
export class ModerationController {
  constructor(
    @Inject(ModerationService) private readonly moderation: ModerationService,
    @Inject(RateLimiter) private readonly limits: RateLimiter,
  ) {}

  @Post('reports')
  @HttpCode(204)
  @UseGuards(SessionGuard)
  async report(@Req() req: AuthedRequest, @Body() body: unknown) {
    const input = parse(reportBody, body)
    await this.limits.hit('report', req.member.id)
    await guarded(() => this.moderation.report(req.member.id, input, input.reason, input.details))
  }

  @Post('appeals')
  @HttpCode(204)
  @UseGuards(SuspendedAllowedGuard)
  async appeal(@Req() req: AuthedRequest, @Body() body: unknown) {
    const { message } = parse(appealBody, body)
    await this.limits.hit('report', req.member.id)
    await guarded(() => this.moderation.appeal(req.member.id, message))
  }

  /** Where the member's latest appeal stands; null if they never appealed. */
  @Get('appeals/latest')
  @UseGuards(SuspendedAllowedGuard)
  async latestAppeal(@Req() req: AuthedRequest) {
    return { appeal: await this.moderation.latestAppeal(req.member.id) }
  }

  @Get('moderation/reports')
  @UseGuards(SessionGuard)
  queue(@Req() req: AuthedRequest) {
    return guarded(() => this.moderation.queue(req.member.id))
  }

  @Get('moderation/log')
  @UseGuards(SessionGuard)
  log(@Req() req: AuthedRequest) {
    return guarded(() => this.moderation.log(req.member.id))
  }

  @Post('moderation/reports/:id/resolve')
  @HttpCode(204)
  @UseGuards(SessionGuard)
  async resolve(@Req() req: AuthedRequest, @Param('id') id: string, @Body() body: unknown) {
    const { resolution, note: why } = parse(resolveBody, body)
    const reportId = parse(z.uuid(), id)
    await guarded(() => this.moderation.resolve(req.member.id, reportId, resolution, why))
  }

  @Post('moderation/posts/:id/restore')
  @HttpCode(204)
  @UseGuards(SessionGuard)
  async restore(@Req() req: AuthedRequest, @Param('id') id: string, @Body() body: unknown) {
    const postId = parse(z.uuid(), id)
    await guarded(() => this.moderation.restorePost(req.member.id, postId, parse(note, body ?? {}).note))
  }

  @Post('moderation/members/:handle/reinstate')
  @HttpCode(204)
  @UseGuards(SessionGuard)
  async reinstate(@Req() req: AuthedRequest, @Param('handle') handle: string, @Body() body: unknown) {
    const who = parse(handleParam, handle)
    await guarded(() => this.moderation.setSuspended(req.member.id, who, false, parse(note, body ?? {}).note))
  }

  /** Every community and who moderates it. Site moderators only. */
  @Get('moderation/moderators')
  @UseGuards(SessionGuard)
  roster(@Req() req: AuthedRequest) {
    return guarded(() => this.moderation.moderatorRoster(req.member.id))
  }

  @Post('moderation/communities/:slug/photo/remove')
  @HttpCode(204)
  @UseGuards(SessionGuard)
  async removeCommunityPhoto(@Req() req: AuthedRequest, @Param('slug') slug: string, @Body() body: unknown) {
    await guarded(() => this.moderation.removeCommunityPhoto(req.member.id, parse(slugParam, slug), parse(note, body ?? {}).note))
  }

  @Put('moderation/communities/:slug/moderators/:handle')
  @HttpCode(204)
  @UseGuards(SessionGuard)
  async grant(@Req() req: AuthedRequest, @Param('slug') slug: string, @Param('handle') handle: string, @Body() body: unknown) {
    const [where, who] = [parse(slugParam, slug), parse(handleParam, handle)]
    await guarded(() => this.moderation.assignCommunityModerator(req.member.id, who, where, true, parse(note, body ?? {}).note))
  }

  @Delete('moderation/communities/:slug/moderators/:handle')
  @HttpCode(204)
  @UseGuards(SessionGuard)
  async revoke(@Req() req: AuthedRequest, @Param('slug') slug: string, @Param('handle') handle: string) {
    const [where, who] = [parse(slugParam, slug), parse(handleParam, handle)]
    await guarded(() => this.moderation.assignCommunityModerator(req.member.id, who, where, false))
  }
}
