import { Controller, Get, Inject, Query, Req, UseGuards } from '@nestjs/common'
import { z } from 'zod'
import { type AuthedRequest, type MaybeAuthedRequest, OptionalSessionGuard, SessionGuard } from '../auth/session.guard.js'
import { CommunitiesService } from '../communities/communities.service.js'
import { paged, parse } from '../http.js'
import { MENTION_CURSOR_MAX, MembersService } from '../members/members.service.js'
import { PostsService } from '../posts/posts.service.js'
import { RateLimiter, visitor } from '../rate-limit.js'

const searchQuery = z.object({ q: z.string().trim().min(2).max(80) })
// What can follow an @ in a handle (infra/kratos/identity.schema.json).
const mentionQuery = z.object({ q: z.string().regex(/^[A-Za-z0-9_]{1,20}$/), cursor: z.string().max(MENTION_CURSOR_MAX).optional() })

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

  // No cache-control: the answer depends on who is asking (whom they follow and have blocked).
  @Get('mentions')
  @UseGuards(SessionGuard)
  async mentions(@Req() req: AuthedRequest, @Query() query: unknown) {
    const { q, cursor } = parse(mentionQuery, query)
    await this.limits.hit('mentionSuggest', req.member.id)
    return paged(() => this.members.suggestMentions(req.member.id, q, cursor))
  }
}
