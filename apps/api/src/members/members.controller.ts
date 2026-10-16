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
import { handleParam, paged, pageQuery, parse } from '../http.js'
import { PostsService, PROFILE_FILTERS } from '../posts/posts.service.js'
import { RateLimiter } from '../rate-limit.js'
import { CannotFollowSelfError, MembersService, profileInput } from './members.service.js'

const memberPostsQuery = pageQuery.extend({ filter: z.enum(PROFILE_FILTERS).default('posts') })

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
    const viewerId = req.member?.id ?? null
    const profile = await this.members.profile(viewerId, handleOf(handle))
    if (profile) return profile
    // A handle given up recently: say which one its owner uses now, so the web
    // app can send old links there.
    const movedTo = await this.members.movedTo(viewerId, handleOf(handle))
    throw new NotFoundException(movedTo ? { movedTo } : undefined)
  }

  @Get(':handle/posts')
  @UseGuards(OptionalSessionGuard)
  async memberPosts(@Req() req: MaybeAuthedRequest, @Param('handle') handle: string, @Query() query: unknown) {
    const { limit, cursor, filter } = parse(memberPostsQuery, query)
    const viewerId = req.member?.id ?? null
    const profile = await this.members.profile(viewerId, handleOf(handle))
    if (!profile) throw new NotFoundException()
    return paged(() => this.posts.byAuthor(viewerId, profile.id, limit, cursor, filter))
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

/** The member's own name and bio. */
@Controller('v1/me/profile')
export class OwnProfileController {
  constructor(
    @Inject(MembersService) private readonly members: MembersService,
    @Inject(RateLimiter) private readonly limits: RateLimiter,
  ) {}

  @Put()
  @HttpCode(204)
  @UseGuards(SessionGuard)
  async update(@Req() req: AuthedRequest, @Body() body: unknown) {
    const profile = parse(profileInput, body)
    this.limits.hit('profile', req.member.id)
    await this.members.updateProfile(req.member.id, profile)
  }
}
