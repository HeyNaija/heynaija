import { Body, Controller, Get, HttpCode, HttpException, Inject, Param, Post, Put, Query, Req, UseGuards } from '@nestjs/common'
import { z } from 'zod'
import { type AuthedRequest, SessionGuard } from '../auth/session.guard.js'
import { CallsEnabledGuard } from '../calls/calls-enabled.guard.js'
import { routeNotFound } from '../gists/gists-enabled.guard.js'
import { parse } from '../http.js'
import { RateLimiter } from '../rate-limit.js'
import { MAX_PARTICIPANTS, MeetingError, MeetingsService } from './meetings.service.js'

const startBody = z.object({ memberIds: z.array(z.uuid()).max(MAX_PARTICIPANTS - 1) }).strict()
const memberBody = z.object({ memberId: z.uuid() }).strict()
const lockBody = z.object({ locked: z.boolean() }).strict()
const searchQuery = z.object({ q: z.string().max(80).optional() })

const messages: Record<Exclude<MeetingError['code'], 'not_found'>, string> = {
  already_in_meeting: 'You are already in a meeting.',
  in_call: 'You are on a call.',
  full: 'This meeting is full.',
  locked: 'This meeting is locked.',
  livekit_unavailable: 'Meetings are not available right now. Try again in a moment.',
}

/**
 * Turns a refusal into an HTTP answer. Everything the caller must not be able to
 * tell apart (missing, not eligible, blocked, removed, not invited) is the same 404
 * a missing route gives, and says nothing about why.
 */
async function answer<T>(req: AuthedRequest, run: () => Promise<T>): Promise<T> {
  try {
    return await run()
  } catch (err) {
    if (!(err instanceof MeetingError)) throw err
    if (err.code === 'not_found') throw routeNotFound(req)
    throw new HttpException({ code: err.code, message: messages[err.code] }, err.status)
  }
}

/**
 * Small group voice meetings (docs/adr/0017 stage 2), on the calls flag: with CALLS_ENABLED
 * off every route is the 404 of a missing route, before sign-in.
 */
@Controller('v1/meetings')
@UseGuards(CallsEnabledGuard, SessionGuard)
export class MeetingsController {
  constructor(
    @Inject(MeetingsService) private readonly meetings: MeetingsService,
    @Inject(RateLimiter) private readonly limits: RateLimiter,
  ) {}

  /** The invitation waiting for me now, or null. The web app polls this. */
  @Get('incoming')
  async incoming(@Req() req: AuthedRequest) {
    await this.limits.hit('meetingPoll', req.member.id)
    return { meeting: await answer(req, () => this.meetings.incoming(req.member)) }
  }

  @Post()
  async start(@Req() req: AuthedRequest, @Body() body: unknown) {
    const { memberIds } = parse(startBody, body)
    await this.limits.hit('meetingStart', req.member.id)
    return answer(req, () => this.meetings.create(req.member, memberIds))
  }

  @Get(':id')
  async get(@Req() req: AuthedRequest, @Param('id') id: string) {
    await this.limits.hit('meetingPoll', req.member.id)
    return answer(req, () => this.meetings.get(req.member, id))
  }

  /** Members the host can invite: only those who pass `canCall` with the host. */
  @Get(':id/invitable')
  async invitable(@Req() req: AuthedRequest, @Param('id') id: string, @Query() query: unknown) {
    const { q } = parse(searchQuery, query)
    await this.limits.hit('meetingSearch', req.member.id)
    return { people: await answer(req, () => this.meetings.invitable(req.member, id, q ?? '')) }
  }

  @Post(':id/join')
  @HttpCode(200)
  async join(@Req() req: AuthedRequest, @Param('id') id: string) {
    await this.limits.hit('meetingAction', req.member.id)
    return answer(req, () => this.meetings.join(req.member, id))
  }

  @Post(':id/decline')
  @HttpCode(204)
  async decline(@Req() req: AuthedRequest, @Param('id') id: string) {
    await this.limits.hit('meetingAction', req.member.id)
    await answer(req, () => this.meetings.decline(req.member, id))
  }

  @Post(':id/leave')
  @HttpCode(204)
  async leave(@Req() req: AuthedRequest, @Param('id') id: string) {
    await this.limits.hit('meetingAction', req.member.id)
    await answer(req, () => this.meetings.leave(req.member, id))
  }

  @Post(':id/end')
  @HttpCode(204)
  async end(@Req() req: AuthedRequest, @Param('id') id: string) {
    await this.limits.hit('meetingAction', req.member.id)
    await answer(req, () => this.meetings.end(req.member, id))
  }

  @Post(':id/invite')
  @HttpCode(200)
  async invite(@Req() req: AuthedRequest, @Param('id') id: string, @Body() body: unknown) {
    const { memberId } = parse(memberBody, body)
    await this.limits.hit('meetingInvite', req.member.id)
    return answer(req, () => this.meetings.invite(req.member, id, memberId))
  }

  @Post(':id/remove')
  @HttpCode(204)
  async remove(@Req() req: AuthedRequest, @Param('id') id: string, @Body() body: unknown) {
    const { memberId } = parse(memberBody, body)
    await this.limits.hit('meetingAction', req.member.id)
    await answer(req, () => this.meetings.remove(req.member, id, memberId))
  }

  @Put(':id/lock')
  async lock(@Req() req: AuthedRequest, @Param('id') id: string, @Body() body: unknown) {
    const { locked } = parse(lockBody, body)
    await this.limits.hit('meetingAction', req.member.id)
    return answer(req, () => this.meetings.setLocked(req.member, id, locked))
  }

  /** `{ url, token, meeting }`: the only way into the room, and the reconnect call. */
  @Post(':id/token')
  @HttpCode(200)
  async token(@Req() req: AuthedRequest, @Param('id') id: string) {
    await this.limits.hit('meetingAction', req.member.id)
    return answer(req, () => this.meetings.token(req.member, id))
  }
}
