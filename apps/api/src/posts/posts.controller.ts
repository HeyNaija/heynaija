import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  NotFoundException,
  Param,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common'
import { z } from 'zod'
import {
  type AuthedRequest,
  type MaybeAuthedRequest,
  OptionalSessionGuard,
  SessionGuard,
} from '../auth/session.guard.js'
import { paged, pageQuery, parse, slugParam } from '../http.js'
import { RateLimiter } from '../rate-limit.js'
import {
  CommunityNotFoundError,
  NotACommunityMemberError,
  ParentNotFoundError,
  PostsService,
  postText,
} from './posts.service.js'

const createPostBody = z.object({
  text: postText,
  replyTo: z.uuid().optional(),
  community: slugParam.optional(),
})

// Same answer for "not yours", "deleted" and "never existed": nothing to learn by probing.
const postId = (id: string): string => {
  if (!z.uuid().safeParse(id).success) throw new NotFoundException()
  return id
}

@Controller('v1')
export class PostsController {
  constructor(
    @Inject(PostsService) private readonly posts: PostsService,
    @Inject(RateLimiter) private readonly limits: RateLimiter,
  ) {}

  @Get('feed')
  @UseGuards(OptionalSessionGuard)
  feed(@Req() req: MaybeAuthedRequest, @Query() query: unknown) {
    const { limit, cursor } = parse(pageQuery, query)
    return paged(() => this.posts.feed(req.member?.id ?? null, limit, cursor))
  }

  @Get('feed/following')
  @UseGuards(SessionGuard)
  following(@Req() req: AuthedRequest, @Query() query: unknown) {
    const { limit, cursor } = parse(pageQuery, query)
    return paged(() => this.posts.followingFeed(req.member.id, limit, cursor))
  }

  @Get('bookmarks')
  @UseGuards(SessionGuard)
  bookmarks(@Req() req: AuthedRequest, @Query() query: unknown) {
    const { limit, cursor } = parse(pageQuery, query)
    return paged(() => this.posts.bookmarked(req.member.id, limit, cursor))
  }

  @Get('trending')
  @UseGuards(OptionalSessionGuard)
  trending(@Req() req: MaybeAuthedRequest) {
    return this.posts.trending(req.member?.id ?? null, 5)
  }

  @Get('posts/:id')
  @UseGuards(OptionalSessionGuard)
  async thread(@Req() req: MaybeAuthedRequest, @Param('id') id: string) {
    const thread = await this.posts.thread(req.member?.id ?? null, postId(id))
    if (!thread) throw new NotFoundException()
    return thread
  }

  @Post('posts')
  @UseGuards(SessionGuard)
  async create(@Req() req: AuthedRequest, @Body() body: unknown) {
    const { text, replyTo, community } = parse(createPostBody, body)
    this.limits.hit('post', req.member.id)
    try {
      return await this.posts.create(req.member.id, text, { replyTo, communitySlug: community })
    } catch (err) {
      const code =
        err instanceof ParentNotFoundError
          ? 'parent_gone'
          : err instanceof CommunityNotFoundError
            ? 'community_gone'
            : err instanceof NotACommunityMemberError
              ? 'not_a_member'
              : null
      if (code) throw new BadRequestException({ code, message: (err as Error).message })
      throw err
    }
  }

  @Delete('posts/:id')
  @HttpCode(204)
  @UseGuards(SessionGuard)
  async remove(@Req() req: AuthedRequest, @Param('id') id: string) {
    if (!(await this.posts.remove(req.member.id, postId(id)))) throw new NotFoundException()
  }

  @Put('posts/:id/like')
  @HttpCode(204)
  @UseGuards(SessionGuard)
  async like(@Req() req: AuthedRequest, @Param('id') id: string) {
    this.limits.hit('action', req.member.id)
    if (!(await this.posts.like(req.member.id, postId(id)))) throw new NotFoundException()
  }

  @Delete('posts/:id/like')
  @HttpCode(204)
  @UseGuards(SessionGuard)
  async unlike(@Req() req: AuthedRequest, @Param('id') id: string) {
    await this.posts.unlike(req.member.id, postId(id))
  }

  @Put('posts/:id/bookmark')
  @HttpCode(204)
  @UseGuards(SessionGuard)
  async bookmark(@Req() req: AuthedRequest, @Param('id') id: string) {
    this.limits.hit('action', req.member.id)
    if (!(await this.posts.bookmark(req.member.id, postId(id)))) throw new NotFoundException()
  }

  @Delete('posts/:id/bookmark')
  @HttpCode(204)
  @UseGuards(SessionGuard)
  async unbookmark(@Req() req: AuthedRequest, @Param('id') id: string) {
    await this.posts.unbookmark(req.member.id, postId(id))
  }
}
