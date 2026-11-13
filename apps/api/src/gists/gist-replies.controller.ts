import { Body, Controller, Delete, Get, HttpCode, HttpException, Inject, Param, Post, Put, Query, Req, UseGuards } from '@nestjs/common'
import { z } from 'zod'
import { GIST_REPLY_AUDIENCES } from '@heynaija/db'
import { type AuthedRequest, OptionalSessionGuard, SessionGuard } from '../auth/session.guard.js'
import { paged, parse, routeNotFound } from '../http.js'
import { postText } from '../posts/posts.service.js'
import { replyPageQuery } from '../posts/reply-cursor.js'
import { RateLimiter } from '../rate-limit.js'
import { GistRepliesService } from './gist-replies.service.js'
import { GistsEnabledGuard } from './gists-enabled.guard.js'
import { GistError } from './gists.service.js'

const createBody = z.object({ text: postText, replyTo: z.uuid().optional() })
const audienceBody = z.object({ audience: z.enum(GIST_REPLY_AUDIENCES) })

const statusMessages: Partial<Record<GistError['code'], string>> = {
  forbidden: 'Only the host can do that.',
  reply_not_allowed: 'The host limited who can reply.',
}

async function answer<T>(req: AuthedRequest, run: () => Promise<T>): Promise<T> {
  try {
    return await run()
  } catch (err) {
    if (!(err instanceof GistError)) throw err
    if (err.code === 'not_found') throw routeNotFound(req)
    throw new HttpException({ code: err.code, message: statusMessages[err.code] ?? err.message }, err.status)
  }
}

@Controller('v1/gists/:id/replies')
@UseGuards(OptionalSessionGuard, GistsEnabledGuard, SessionGuard)
export class GistRepliesController {
  constructor(
    @Inject(GistRepliesService) private readonly replies: GistRepliesService,
    @Inject(RateLimiter) private readonly limits: RateLimiter,
  ) {}

  @Get()
  list(@Req() req: AuthedRequest, @Param('id') id: string, @Query() query: unknown) {
    const { limit, cursor, order } = parse(replyPageQuery, query)
    return answer(req, () => paged(() => this.replies.list(req.member, id, { limit, cursor, order })))
  }

  @Post()
  async create(@Req() req: AuthedRequest, @Param('id') id: string, @Body() body: unknown) {
    const { text, replyTo } = parse(createBody, body)
    await this.limits.hit('post', req.member.id)
    return answer(req, () => this.replies.create(req.member, id, { text, replyTo }))
  }

  @Put('audience')
  @HttpCode(204)
  async audience(@Req() req: AuthedRequest, @Param('id') id: string, @Body() body: unknown) {
    const { audience } = parse(audienceBody, body)
    await this.limits.hit('action', req.member.id)
    await answer(req, () => this.replies.setReplyAudience(req.member, id, audience))
  }

  @Get(':postId')
  get(@Req() req: AuthedRequest, @Param('id') id: string, @Param('postId') postId: string) {
    return answer(req, () => this.replies.get(req.member, id, uuid(postId)))
  }

  @Get(':postId/replies')
  branch(@Req() req: AuthedRequest, @Param('id') id: string, @Param('postId') postId: string, @Query() query: unknown) {
    const { limit, cursor, order } = parse(replyPageQuery, query)
    return answer(req, () => paged(() => this.replies.branch(req.member, id, uuid(postId), { limit, cursor, order })))
  }

  @Put(':postId/like')
  @HttpCode(204)
  async like(@Req() req: AuthedRequest, @Param('id') id: string, @Param('postId') postId: string) {
    await this.limits.hit('action', req.member.id)
    await answer(req, () => this.replies.like(req.member, id, uuid(postId)))
  }

  @Delete(':postId/like')
  @HttpCode(204)
  async unlike(@Req() req: AuthedRequest, @Param('postId') postId: string) {
    await this.replies.unlike(req.member, uuid(postId))
  }

  @Put(':postId/hide')
  @HttpCode(204)
  async hide(@Req() req: AuthedRequest, @Param('id') id: string, @Param('postId') postId: string) {
    await this.limits.hit('action', req.member.id)
    await answer(req, () => this.replies.hide(req.member, id, uuid(postId), true))
  }

  @Delete(':postId/hide')
  @HttpCode(204)
  async unhide(@Req() req: AuthedRequest, @Param('id') id: string, @Param('postId') postId: string) {
    await this.limits.hit('action', req.member.id)
    await answer(req, () => this.replies.hide(req.member, id, uuid(postId), false))
  }
}

const uuid = (value: string): string => (z.uuid().safeParse(value).success ? value : '00000000-0000-0000-0000-000000000000')
