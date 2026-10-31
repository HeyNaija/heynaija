import { Body, Controller, Get, HttpCode, HttpException, Inject, Param, Post, Put, Req, UseGuards } from '@nestjs/common'
import { z } from 'zod'
import { type AuthedRequest, SessionGuard } from '../auth/session.guard.js'
import { parse } from '../http.js'
import { RateLimiter } from '../rate-limit.js'
import { routeNotFound } from '../gists/gists-enabled.guard.js'
import { CallsEnabledGuard } from './calls-enabled.guard.js'
import { CallError, CallsService } from './calls.service.js'

const startBody = z.object({ memberId: z.uuid() }).strict()
const settingsBody = z.object({ allowCalls: z.boolean() }).strict()

const messages: Record<Exclude<CallError['code'], 'not_found'>, string> = {
  busy: 'They are on another call.',
  already_in_call: 'You are already on a call.',
  livekit_unavailable: 'Calls are not available right now. Try again in a moment.',
}

/**
 * Turns a refusal into an HTTP answer. Everything the caller must not be able to
 * tell apart (missing, not eligible, blocked, over) is the same 404 a missing
 * route gives, and says nothing about why.
 */
async function answer<T>(req: AuthedRequest, run: () => Promise<T>): Promise<T> {
  try {
    return await run()
  } catch (err) {
    if (!(err instanceof CallError)) throw err
    if (err.code === 'not_found') throw routeNotFound(req)
    throw new HttpException({ code: err.code, message: messages[err.code] }, err.status)
  }
}

/** 1:1 voice calls (docs/adr/0017 stage 1). The flag is checked before sign-in. */
@Controller('v1/calls')
@UseGuards(CallsEnabledGuard, SessionGuard)
export class CallsController {
  constructor(
    @Inject(CallsService) private readonly calls: CallsService,
    @Inject(RateLimiter) private readonly limits: RateLimiter,
  ) {}

  @Get('settings')
  settings(@Req() req: AuthedRequest) {
    return answer(req, () => this.calls.settings(req.member))
  }

  @Put('settings')
  async setSettings(@Req() req: AuthedRequest, @Body() body: unknown) {
    const { allowCalls } = parse(settingsBody, body)
    await this.limits.hit('action', req.member.id)
    return answer(req, () => this.calls.setAllowCalls(req.member, allowCalls))
  }

  /** Whether the Call button should show for this member: 200 for a yes, the missing-route 404 for anything else. */
  @Get('can-call/:memberId')
  async canCall(@Req() req: AuthedRequest, @Param('memberId') memberId: string) {
    await this.limits.hit('callPoll', req.member.id)
    // Only a yes is an answer. Every no (not on the list, blocked, ineligible) is the 404 of a missing route.
    if (!(await this.calls.canCallMember(req.member, memberId))) throw routeNotFound(req)
    return { eligible: true }
  }

  /** The call ringing for me now, or null. The web app polls this. */
  @Get('incoming')
  async incoming(@Req() req: AuthedRequest) {
    await this.limits.hit('callPoll', req.member.id)
    return { call: await answer(req, () => this.calls.incoming(req.member)) }
  }

  @Post()
  async start(@Req() req: AuthedRequest, @Body() body: unknown) {
    const { memberId } = parse(startBody, body)
    await this.limits.hit('callStart', req.member.id)
    await this.limits.hit('callPair', `${req.member.id}:${memberId}`)
    return answer(req, () => this.calls.create(req.member, memberId))
  }

  @Get(':id')
  async get(@Req() req: AuthedRequest, @Param('id') id: string) {
    await this.limits.hit('callPoll', req.member.id)
    return answer(req, () => this.calls.get(req.member, id))
  }

  @Post(':id/accept')
  @HttpCode(200)
  async accept(@Req() req: AuthedRequest, @Param('id') id: string) {
    await this.limits.hit('callAction', req.member.id)
    return answer(req, () => this.calls.accept(req.member, id))
  }

  @Post(':id/decline')
  @HttpCode(204)
  async decline(@Req() req: AuthedRequest, @Param('id') id: string) {
    await this.limits.hit('callAction', req.member.id)
    await answer(req, () => this.calls.decline(req.member, id))
  }

  @Post(':id/cancel')
  @HttpCode(204)
  async cancel(@Req() req: AuthedRequest, @Param('id') id: string) {
    await this.limits.hit('callAction', req.member.id)
    await answer(req, () => this.calls.cancel(req.member, id))
  }

  @Post(':id/end')
  @HttpCode(204)
  async end(@Req() req: AuthedRequest, @Param('id') id: string) {
    await this.limits.hit('callAction', req.member.id)
    await answer(req, () => this.calls.end(req.member, id))
  }

  /** `{ url, token, call }`: the only way into the room, and the reconnect call. */
  @Post(':id/token')
  @HttpCode(200)
  async token(@Req() req: AuthedRequest, @Param('id') id: string) {
    await this.limits.hit('callAction', req.member.id)
    return answer(req, () => this.calls.token(req.member, id))
  }
}
