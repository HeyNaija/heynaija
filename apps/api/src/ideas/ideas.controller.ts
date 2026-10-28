import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  ForbiddenException,
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
import { type AuthedRequest, type MaybeAuthedRequest, OptionalSessionGuard, SessionGuard } from '../auth/session.guard.js'
import { parse } from '../http.js'
import { LinksService } from '../links/links.service.js'
import { CommunityNotFoundError } from '../posts/posts.service.js'
import { RateLimiter } from '../rate-limit.js'
import {
  BadDuplicateError,
  boardQuery,
  IdeaClosedError,
  IdeasService,
  NotABoardModeratorError,
  newIdea,
  statusChange,
} from './ideas.service.js'

// Same answer for "not an idea", "deleted" and "never existed".
const ideaId = (id: string): string => {
  if (!z.uuid().safeParse(id).success) throw new NotFoundException()
  return id
}

const similarQuery = z.object({ q: z.string().max(200).default('') })

@Controller('v1/ideas')
export class IdeasController {
  constructor(
    @Inject(IdeasService) private readonly ideas: IdeasService,
    @Inject(LinksService) private readonly links: LinksService,
    @Inject(RateLimiter) private readonly limits: RateLimiter,
  ) {}

  /** The board, for anyone: open, shipped or closed ideas, by votes or newest. */
  @Get()
  @UseGuards(OptionalSessionGuard)
  board(@Req() req: MaybeAuthedRequest, @Query() query: unknown) {
    return this.ideas.board(req.member?.id ?? null, parse(boardQuery, query))
  }

  /** Ideas like the one being written, so it is not sent twice. */
  @Get('similar')
  @UseGuards(OptionalSessionGuard)
  async similar(@Req() req: MaybeAuthedRequest, @Query() query: unknown) {
    if (req.member) await this.limits.hit('search', req.member.id)
    return this.ideas.similar(req.member?.id ?? null, parse(similarQuery, query).q)
  }

  @Get(':id')
  @UseGuards(OptionalSessionGuard)
  async get(@Req() req: MaybeAuthedRequest, @Param('id') id: string) {
    const idea = await this.ideas.get(req.member?.id ?? null, ideaId(id))
    if (!idea) throw new NotFoundException()
    return idea
  }

  /** Sends an idea or a problem. It is a post, so it counts toward the posting limit. */
  @Post()
  @UseGuards(SessionGuard)
  async create(@Req() req: AuthedRequest, @Body() body: unknown) {
    const idea = parse(newIdea, body)
    await this.limits.hit('post', req.member.id)
    try {
      const { id, linkUrl } = await this.ideas.create(req.member.id, idea)
      if (linkUrl) await this.links.request(linkUrl)
      return { id }
    } catch (err) {
      if (err instanceof CommunityNotFoundError) throw new BadRequestException({ code: 'board_missing', message: 'the board is not set up' })
      throw err
    }
  }

  @Put(':id/vote')
  @HttpCode(204)
  @UseGuards(SessionGuard)
  async vote(@Req() req: AuthedRequest, @Param('id') id: string) {
    await this.limits.hit('action', req.member.id)
    try {
      if (!(await this.ideas.vote(req.member.id, ideaId(id), true))) throw new NotFoundException()
    } catch (err) {
      if (err instanceof IdeaClosedError) throw new ConflictException({ code: 'idea_closed', message: err.message })
      throw err
    }
  }

  @Delete(':id/vote')
  @HttpCode(204)
  @UseGuards(SessionGuard)
  async unvote(@Req() req: AuthedRequest, @Param('id') id: string) {
    if (!(await this.ideas.vote(req.member.id, ideaId(id), false))) throw new NotFoundException()
  }

  /** Sets an idea's status. For Building HeyNaija's moderators and site-wide ones. */
  @Put(':id/status')
  @HttpCode(204)
  @UseGuards(SessionGuard)
  async setStatus(@Req() req: AuthedRequest, @Param('id') id: string, @Body() body: unknown) {
    const change = parse(statusChange, body)
    await this.limits.hit('action', req.member.id)
    try {
      if (!(await this.ideas.setStatus(req.member.id, ideaId(id), change))) throw new NotFoundException()
    } catch (err) {
      if (err instanceof NotABoardModeratorError) throw new ForbiddenException({ code: 'not_a_moderator', message: err.message })
      if (err instanceof BadDuplicateError) throw new BadRequestException({ code: 'bad_duplicate', message: err.message })
      throw err
    }
  }
}
