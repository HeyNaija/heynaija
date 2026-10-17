import { Controller, Get, Inject, Query, Req, UseGuards } from '@nestjs/common'
import { z } from 'zod'
import { type MaybeAuthedRequest, OptionalSessionGuard } from '../auth/session.guard.js'
import { CommunitiesService } from '../communities/communities.service.js'
import { parse } from '../http.js'
import { MembersService } from '../members/members.service.js'
import { PostsService } from '../posts/posts.service.js'
import { RateLimiter, visitor } from '../rate-limit.js'

const searchQuery = z.object({ q: z.string().trim().min(2).max(80) })

/** Searches only what heynaija itself holds: members, communities and posts. */
@Controller('v1/search')
export class SearchController {
  constructor(
    @Inject(MembersService) private readonly members: MembersService,
    @Inject(CommunitiesService) private readonly communities: CommunitiesService,
    @Inject(PostsService) private readonly posts: PostsService,
    @Inject(RateLimiter) private readonly limits: RateLimiter,
  ) {}

  @Get()
  @UseGuards(OptionalSessionGuard)
  async search(@Req() req: MaybeAuthedRequest, @Query() query: unknown) {
    const { q } = parse(searchQuery, query)
    const viewerId = req.member?.id ?? null
    await this.limits.hit('search', viewerId ?? visitor(req))
    const [members, communities, posts] = await Promise.all([
      this.members.search(q, 5),
      this.communities.search(viewerId, q, 5),
      this.posts.search(viewerId, q, 30),
    ])
    return { members, communities, posts }
  }
}
