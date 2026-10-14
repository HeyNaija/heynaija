import {
  BadRequestException,
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
import { handleParam, paged, pageQuery, parse } from '../http.js'
import { PostsService } from '../posts/posts.service.js'
import { RateLimiter } from '../rate-limit.js'
import { CannotFollowSelfError, MembersService } from './members.service.js'

const handleOf = (raw: string): string => {
  const parsed = handleParam.safeParse(raw)
  if (!parsed.success) throw new NotFoundException()
  return parsed.data
}

@Controller('v1/members')
export class MembersController {
  constructor(
    @Inject(MembersService) private readonly members: MembersService,
    @Inject(PostsService) private readonly posts: PostsService,
    @Inject(RateLimiter) private readonly limits: RateLimiter,
  ) {}

  @Get(':handle')
  @UseGuards(OptionalSessionGuard)
  async profile(@Req() req: MaybeAuthedRequest, @Param('handle') handle: string) {
    const profile = await this.members.profile(req.member?.id ?? null, handleOf(handle))
    if (!profile) throw new NotFoundException()
    return profile
  }

  @Get(':handle/posts')
  @UseGuards(OptionalSessionGuard)
  async memberPosts(@Req() req: MaybeAuthedRequest, @Param('handle') handle: string, @Query() query: unknown) {
    const { limit, cursor } = parse(pageQuery, query)
    const viewerId = req.member?.id ?? null
    const profile = await this.members.profile(viewerId, handleOf(handle))
    if (!profile) throw new NotFoundException()
    return paged(() => this.posts.byAuthor(viewerId, profile.id, limit, cursor))
  }

  @Put(':handle/follow')
  @HttpCode(204)
  @UseGuards(SessionGuard)
  async follow(@Req() req: AuthedRequest, @Param('handle') handle: string) {
    this.limits.hit('action', req.member.id)
    try {
      if (!(await this.members.follow(req.member.id, handleOf(handle)))) throw new NotFoundException()
    } catch (err) {
      if (err instanceof CannotFollowSelfError) throw new BadRequestException(err.message)
      throw err
    }
  }

  @Delete(':handle/follow')
  @HttpCode(204)
  @UseGuards(SessionGuard)
  async unfollow(@Req() req: AuthedRequest, @Param('handle') handle: string) {
    if (!(await this.members.unfollow(req.member.id, handleOf(handle)))) throw new NotFoundException()
  }

  @Put(':handle/block')
  @HttpCode(204)
  @UseGuards(SessionGuard)
  async block(@Req() req: AuthedRequest, @Param('handle') handle: string) {
    this.limits.hit('action', req.member.id)
    if (!(await this.members.block(req.member.id, handleOf(handle)))) throw new NotFoundException()
  }

  @Delete(':handle/block')
  @HttpCode(204)
  @UseGuards(SessionGuard)
  async unblock(@Req() req: AuthedRequest, @Param('handle') handle: string) {
    await this.members.unblock(req.member.id, handleOf(handle))
  }

  @Put(':handle/mute')
  @HttpCode(204)
  @UseGuards(SessionGuard)
  async mute(@Req() req: AuthedRequest, @Param('handle') handle: string) {
    this.limits.hit('action', req.member.id)
    if (!(await this.members.mute(req.member.id, handleOf(handle)))) throw new NotFoundException()
  }

  @Delete(':handle/mute')
  @HttpCode(204)
  @UseGuards(SessionGuard)
  async unmute(@Req() req: AuthedRequest, @Param('handle') handle: string) {
    await this.members.unmute(req.member.id, handleOf(handle))
  }
}
