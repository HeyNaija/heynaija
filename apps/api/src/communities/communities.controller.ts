import {
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  Inject,
  NotFoundException,
  Param,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common'
import {
  type AuthedRequest,
  type MaybeAuthedRequest,
  OptionalSessionGuard,
  SessionGuard,
} from '../auth/session.guard.js'
import { FeatureFlags } from '../flags/feature-flags.js'
import { Feature, FeatureGuard } from '../flags/feature.guard.js'
import { LabelNotAllowedError } from '../governance/adult-content.js'
import { paged, pageQuery, parse, slugParam } from '../http.js'
import { NotACommunityModeratorError, PostsService } from '../posts/posts.service.js'
import { RateLimiter } from '../rate-limit.js'
import { CommunitiesService } from './communities.service.js'

const slugOf = (raw: string): string => {
  const parsed = slugParam.safeParse(raw)
  if (!parsed.success) throw new NotFoundException()
  return parsed.data
}

@Controller('v1/communities')
export class CommunitiesController {
  constructor(
    @Inject(CommunitiesService) private readonly communities: CommunitiesService,
    @Inject(PostsService) private readonly posts: PostsService,
    @Inject(RateLimiter) private readonly limits: RateLimiter,
    @Inject(FeatureFlags) private readonly flags: FeatureFlags,
  ) {}

  /** Whether announcements (docs/adr/0029) are offered to the viewer; never to someone signed out. */
  private async announcements(viewerId: string | null): Promise<boolean> {
    return viewerId !== null && (await this.flags.isEnabled('communityAnnouncements', viewerId))
  }

  @Get()
  @UseGuards(OptionalSessionGuard)
  async list(@Req() req: MaybeAuthedRequest) {
    const viewerId = req.member?.id ?? null
    return this.communities.list(viewerId, await this.announcements(viewerId))
  }

  @Get(':slug')
  @UseGuards(OptionalSessionGuard)
  async detail(@Req() req: MaybeAuthedRequest, @Param('slug') slug: string) {
    const viewerId = req.member?.id ?? null
    const community = await this.communities.detail(viewerId, slugOf(slug), await this.announcements(viewerId))
    if (!community) throw new NotFoundException()
    return community
  }

  @Get(':slug/posts')
  @UseGuards(OptionalSessionGuard)
  async communityPosts(@Req() req: MaybeAuthedRequest, @Param('slug') slug: string, @Query() query: unknown) {
    const { limit, cursor } = parse(pageQuery, query)
    const viewerId = req.member?.id ?? null
    const community = await this.communities.detail(viewerId, slugOf(slug))
    if (!community) throw new NotFoundException()
    const page = await paged(() => this.posts.inCommunity(viewerId, community.id, limit, cursor))
    // The first page also brings the post its moderators pinned above the rest.
    if (cursor) return page
    return { ...page, pinned: await this.posts.pinnedInCommunity(viewerId, community.id) }
  }

  @Put(':slug/membership')
  @HttpCode(204)
  @UseGuards(SessionGuard)
  async join(@Req() req: AuthedRequest, @Param('slug') slug: string) {
    await this.limits.hit('action', req.member.id)
    if (!(await this.communities.join(req.member.id, slugOf(slug)))) throw new NotFoundException()
  }

  @Delete(':slug/membership')
  @HttpCode(204)
  @UseGuards(SessionGuard)
  async leave(@Req() req: AuthedRequest, @Param('slug') slug: string) {
    if (!(await this.communities.leave(req.member.id, slugOf(slug)))) throw new NotFoundException()
  }

  /** A member asks to be told of the community's announcements again (docs/adr/0029). Turning them off always works. */
  @Put(':slug/announcements')
  @HttpCode(204)
  @UseGuards(SessionGuard, FeatureGuard)
  @Feature('communityAnnouncements')
  announcementsOn(@Req() req: AuthedRequest, @Param('slug') slug: string) {
    return this.setAnnouncements(req, slug, true)
  }

  @Delete(':slug/announcements')
  @HttpCode(204)
  @UseGuards(SessionGuard)
  announcementsOff(@Req() req: AuthedRequest, @Param('slug') slug: string) {
    return this.setAnnouncements(req, slug, false)
  }

  private async setAnnouncements(req: AuthedRequest, slug: string, on: boolean): Promise<void> {
    await this.limits.hit('action', req.member.id)
    if (!(await this.communities.setAnnouncements(req.member.id, slugOf(slug), on))) throw new NotFoundException()
  }

  /** Its moderators mark the whole community sensitive (ADR 0020, question 8). Taking the mark off always works. */
  @Put(':slug/sensitive')
  @HttpCode(204)
  @UseGuards(SessionGuard, FeatureGuard)
  @Feature('adultLabels')
  markSensitive(@Req() req: AuthedRequest, @Param('slug') slug: string) {
    return this.setSensitive(req, slug, true)
  }

  @Delete(':slug/sensitive')
  @HttpCode(204)
  @UseGuards(SessionGuard)
  unmarkSensitive(@Req() req: AuthedRequest, @Param('slug') slug: string) {
    return this.setSensitive(req, slug, false)
  }

  private async setSensitive(req: AuthedRequest, slug: string, on: boolean): Promise<void> {
    await this.limits.hit('action', req.member.id)
    try {
      if (!(await this.communities.setSensitive(req.member.id, slugOf(slug), on))) throw new NotFoundException()
    } catch (err) {
      if (err instanceof NotACommunityModeratorError) throw new ForbiddenException({ code: 'not_a_moderator', message: err.message })
      if (err instanceof LabelNotAllowedError) throw new ForbiddenException({ code: 'label_not_allowed', message: err.message })
      throw err
    }
  }
}
