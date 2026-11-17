import { BadRequestException, Body, ConflictException, Controller, ForbiddenException, Get, HttpCode, Inject, NotFoundException, Param, Post, Put, Query, Req, UseGuards } from '@nestjs/common'
import { z } from 'zod'
import { type AuthedRequest, SessionGuard } from '../../auth/session.guard.js'
import { Feature, FeatureGuard } from '../../flags/feature.guard.js'
import { FeatureFlags } from '../../flags/feature-flags.js'
import { parse } from '../../http.js'
import { ALT_MAX } from '../../media/media.service.js'
import { RateLimiter } from '../../rate-limit.js'
import { ROUND_CHANGES, type RoundChanges } from './round-events.js'
import { ANSWER_MAX, CHOICE_MAX, MAX_QUESTIONS, PROMPT_MAX, TITLE_MAX, TriviaError, TriviaService } from './trivia.service.js'

/** How long a page's request waits for the round to change before answering "nothing new", as chess's (docs/adr/0028). */
export const LONG_POLL_MS = 25_000

// `has`: the open question whose text the page shows ('' for none); see TriviaService.answersNow.
const afterQuery = z.object({ after: z.coerce.number().int().min(-1).default(-1), has: z.string().max(64).optional() })
const question = z.object({
  kind: z.enum(['choice', 'typed']),
  prompt: z.string().max(PROMPT_MAX * 2),
  choices: z.array(z.string().max(CHOICE_MAX * 2)).max(4).optional(),
  correctChoice: z.number().int().min(0).max(3).optional(),
  accepted: z.array(z.string().max(ANSWER_MAX * 2)).max(20).optional(),
  explanation: z.string().max(PROMPT_MAX * 2).nullish(),
  image: z.object({ id: z.uuid(), alt: z.string().max(ALT_MAX * 2) }).nullish(),
})
const roundBody = z.object({
  title: z.string().max(TITLE_MAX * 2),
  community: z.string().max(60).nullish(),
  startsAt: z.iso.datetime({ offset: true }),
  secondsPerQuestion: z.number().int().min(10).max(60).default(20),
  autoAdvance: z.boolean().default(false),
  questions: z.array(question).min(1).max(MAX_QUESTIONS),
})
const answerBody = z.object({ choice: z.number().int().min(0).max(3).optional(), text: z.string().max(ANSWER_MAX * 2).optional() })
const acceptBody = z.object({ answer: z.string().min(1).max(ANSWER_MAX * 2) })
const uuid = (id: string) => {
  if (!z.uuid().safeParse(id).success) throw new NotFoundException()
  return id
}

/** A TriviaError as an HTTP answer, with a `code` the pages word. */
const run = async <T>(work: () => Promise<T>): Promise<T> => {
  try {
    return await work()
  } catch (err) {
    if (!(err instanceof TriviaError)) throw err
    const body = { code: err.code, message: err.message }
    if (err.code === 'not_found') throw new NotFoundException(body)
    if (err.code === 'not_host') throw new ForbiddenException(body)
    if (err.code === 'answered' || err.code === 'closed' || err.code === 'busy') throw new ConflictException(body)
    throw new BadRequestException(body)
  }
}

/**
 * Trivia (docs/adr/0028, phase 7). Behind the `games` flag like every Games route,
 * and its own `trivia` flag: while either is off for the member, a 404.
 */
@Controller('v1/games/trivia')
@UseGuards(SessionGuard, FeatureGuard)
@Feature('games')
export class TriviaController {
  constructor(
    @Inject(TriviaService) private readonly trivia: TriviaService,
    @Inject(FeatureFlags) private readonly flags: Pick<FeatureFlags, 'isEnabled'>,
    @Inject(RateLimiter) private readonly limits: Pick<RateLimiter, 'hit'>,
    @Inject(ROUND_CHANGES) private readonly changes: RoundChanges,
  ) {}

  private async gate(memberId: string): Promise<void> {
    if (!(await this.flags.isEnabled('trivia', memberId))) throw new NotFoundException()
  }

  /** Rounds live now, coming up and recently over; the host's own; and whether the viewer may host. */
  @Get()
  async list(@Req() req: AuthedRequest) {
    await this.gate(req.member.id)
    return this.trivia.list(req.member.id)
  }

  /**
   * A round as the player sees it. With `after`, the version the page has: answers
   * at once with anything newer, else when the next question appears or closes,
   * or when the round changes, waiting at most LONG_POLL_MS.
   */
  @Get('rounds/:id')
  async view(@Req() req: AuthedRequest, @Param('id') id: string, @Query() query: unknown) {
    await this.gate(req.member.id)
    const { after, has } = parse(afterQuery, query)
    const roundId = uuid(id)
    await this.trivia.judgeDue(roundId)
    const view = await this.trivia.view(req.member.id, roundId)
    if (!view) throw new NotFoundException()
    if (this.trivia.answersNow(view, after, has)) return view
    const edge = this.trivia.nextEdge(view)
    const ms = edge ? Math.max(250, Math.min(LONG_POLL_MS, edge.getTime() - view.serverTime.getTime() + 20)) : LONG_POLL_MS
    await this.changes.wait(roundId, ms)
    await this.trivia.judgeDue(roundId)
    return (await this.trivia.view(req.member.id, roundId)) ?? view
  }

  @Post('rounds/:id/questions/:question/answer')
  async answer(@Req() req: AuthedRequest, @Param('id') id: string, @Param('question') question: string, @Body() body: unknown) {
    await this.gate(req.member.id)
    const given = parse(answerBody, body)
    await this.limits.hit('triviaAnswer', req.member.id)
    return run(() => this.trivia.answer(req.member.id, uuid(id), uuid(question), given))
  }

  // --- Hosting ------------------------------------------------------------------------

  @Post('rounds')
  @HttpCode(201)
  async create(@Req() req: AuthedRequest, @Body() body: unknown) {
    await this.gate(req.member.id)
    const b = parse(roundBody, body)
    await this.limits.hit('triviaRound', req.member.id)
    return { id: await run(() => this.trivia.create(req.member.id, { ...b, startsAt: new Date(b.startsAt) })) }
  }

  @Get('rounds/:id/host')
  async host(@Req() req: AuthedRequest, @Param('id') id: string) {
    await this.gate(req.member.id)
    return run(() => this.trivia.hostView(req.member.id, uuid(id)))
  }

  @Put('rounds/:id')
  @HttpCode(204)
  async update(@Req() req: AuthedRequest, @Param('id') id: string, @Body() body: unknown) {
    await this.gate(req.member.id)
    const b = parse(roundBody, body)
    await this.limits.hit('triviaHost', req.member.id)
    await run(() => this.trivia.update(req.member.id, uuid(id), { ...b, startsAt: new Date(b.startsAt) }))
  }

  @Post('rounds/:id/:action')
  @HttpCode(204)
  async act(@Req() req: AuthedRequest, @Param('id') id: string, @Param('action') action: string) {
    await this.gate(req.member.id)
    await this.limits.hit('triviaHost', req.member.id)
    const roundId = uuid(id)
    const member = req.member.id
    const work: Record<string, () => Promise<void>> = {
      publish: () => this.trivia.publish(member, roundId),
      cancel: () => this.trivia.cancel(member, roundId),
      open: () => this.trivia.open(member, roundId),
      end: () => this.trivia.end(member, roundId),
      results: () => this.trivia.publishResults(member, roundId),
    }
    if (!work[action]) throw new NotFoundException()
    await run(work[action])
  }

  @Post('rounds/:id/questions/:question/void')
  @HttpCode(204)
  async void(@Req() req: AuthedRequest, @Param('id') id: string, @Param('question') question: string) {
    await this.gate(req.member.id)
    await this.limits.hit('triviaHost', req.member.id)
    await run(() => this.trivia.void(req.member.id, uuid(id), uuid(question)))
  }

  /** Accepts a group of wrong typed answers, by the form the matcher reads (`normalised` in the host's view). */
  @Post('rounds/:id/questions/:question/accept')
  @HttpCode(204)
  async accept(@Req() req: AuthedRequest, @Param('id') id: string, @Param('question') question: string, @Body() body: unknown) {
    await this.gate(req.member.id)
    const { answer } = parse(acceptBody, body)
    await this.limits.hit('triviaHost', req.member.id)
    await run(() => this.trivia.accept(req.member.id, uuid(id), uuid(question), answer))
  }
}
