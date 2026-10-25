import {
  Controller,
  Delete,
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
import { paged, pageQuery, parse, slugParam } from '../http.js'
import { PostsService } from '../posts/posts.service.js'
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
  ) {}

  @Get()
  @UseGuards(OptionalSessionGuard)
  list(@Req() req: MaybeAuthedRequest) {
    return this.communities.list(req.member?.id ?? null)
  }

  @Get(':slug')
  @UseGuards(OptionalSessionGuard)
  async detail(@Req() req: MaybeAuthedRequest, @Param('slug') slug: string) {
    const community = await this.communities.detail(req.member?.id ?? null, slugOf(slug))
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
}
