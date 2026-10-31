import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  HttpException,
  Inject,
  Param,
  Patch,
  Post,
  Put,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common'
import { z } from 'zod'
import { type AuthedRequest, SessionGuard } from '../auth/session.guard.js'
import { parse } from '../http.js'
import { RateLimiter } from '../rate-limit.js'
import { LiveKitWebhookGuard } from '../calls/calls-enabled.guard.js'
import { CallsService } from '../calls/calls.service.js'
import { ROOM_SERVICE, type RoomService, WebhookRejectedError } from './room-service.js'
import { GistError, GistsService } from './gists.service.js'
import { GistsEnabledGuard, routeNotFound } from './gists-enabled.guard.js'

const createBody = z.object({
  title: z.string().min(1).max(200),
  communityId: z.uuid().nullish(),
})

const settingsBody = z
  .object({
    locked: z.boolean().optional(),
    listenerCap: z.number().int().min(1).max(10_000).nullable().optional(),
    requestsOpen: z.boolean().optional(),
  })
  .strict()

/**
 * Turns a refusal from the service into an HTTP answer. Everything the caller
 * must not be able to tell apart (missing, not eligible, blocked, removed) is the
 * same 404 a missing route gives.
 */
async function answer<T>(req: AuthedRequest, run: () => Promise<T>): Promise<T> {
  try {
    return await run()
  } catch (err) {
    if (!(err instanceof GistError)) throw err
    if (err.code === 'not_found') throw routeNotFound(req)
    throw new HttpException({ code: err.code, message: err.message === err.code ? messages[err.code] : err.message, ...err.details }, err.status)
  }
}

const messages: Record<GistError['code'], string> = {
  not_found: 'Not found',
  forbidden: 'Only the host or a co-host can do that.',
  invalid: 'That is not allowed.',
  gist_full: 'This Gist is full.',
  gist_locked: 'The host has locked this Gist.',
  gist_ended: 'This Gist has ended.',
  already_hosting: 'You are already hosting a live Gist.',
  speakers_full: 'There is no room for more speakers.',
  cohosts_full: 'There is no room for more co-hosts.',
  requests_closed: 'The host is not taking requests to speak.',
  not_in_gist: 'Join the Gist first.',
  not_eligible: 'That member cannot be given the microphone.',
  already_speaker: 'You are already on the stage.',
  livekit_unavailable: 'The audio service is not available. Try again in a moment.',
}

@Controller('v1/gists')
@UseGuards(GistsEnabledGuard, SessionGuard)
export class GistsController {
  constructor(
    @Inject(GistsService) private readonly gists: GistsService,
    @Inject(RateLimiter) private readonly limits: RateLimiter,
  ) {}

  /** Starts a Gist now, with the caller as host. */
  @Post()
  async create(@Req() req: AuthedRequest, @Body() body: unknown) {
    const input = parse(createBody, body)
    await this.limits.hit('gistCreate', req.member.id)
    return answer(req, () => this.gists.create(req.member, input))
  }

  @Get(':id')
  get(@Req() req: AuthedRequest, @Param('id') id: string) {
    return answer(req, () => this.gists.get(req.member, id))
  }

  /** A listener token and the role the member has. Also the reconnect call. The per-Gist limit is in the service, after eligibility. */
  @Post(':id/join')
  @HttpCode(200)
  async join(@Req() req: AuthedRequest, @Param('id') id: string) {
    await this.limits.hit('gistJoin', req.member.id)
    return answer(req, () => this.gists.join(req.member, id))
  }

  @Post(':id/leave')
  @HttpCode(204)
  async leave(@Req() req: AuthedRequest, @Param('id') id: string) {
    await answer(req, () => this.gists.leave(req.member, id))
  }

  /** Once connected: reset my LiveKit permissions to my role. */
  @Post(':id/sync')
  @HttpCode(200)
  async sync(@Req() req: AuthedRequest, @Param('id') id: string) {
    await this.limits.hit('gistSync', req.member.id)
    return answer(req, () => this.gists.sync(req.member, id))
  }

  @Put(':id/speak-request')
  @HttpCode(204)
  async request(@Req() req: AuthedRequest, @Param('id') id: string) {
    await this.limits.hit('gistRequest', req.member.id)
    await answer(req, () => this.gists.requestToSpeak(req.member, id))
  }

  @Delete(':id/speak-request')
  @HttpCode(204)
  async cancelRequest(@Req() req: AuthedRequest, @Param('id') id: string) {
    await answer(req, () => this.gists.cancelRequest(req.member, id))
  }

  /** Host and co-hosts: the queue of requests to speak, oldest first. */
  @Get(':id/requests')
  async requests(@Req() req: AuthedRequest, @Param('id') id: string) {
    return { items: await answer(req, () => this.gists.requests(req.member, id)) }
  }

  /** Host and co-hosts: who is listening. */
  @Get(':id/listeners')
  async listeners(@Req() req: AuthedRequest, @Param('id') id: string) {
    return { items: await answer(req, () => this.gists.listeners(req.member, id)) }
  }

  /** Approve a request, or invite a listener to speak. */
  @Put(':id/speakers/:memberId')
  @HttpCode(204)
  async addSpeaker(@Req() req: AuthedRequest, @Param('id') id: string, @Param('memberId') memberId: string) {
    await this.limits.hit('action', req.member.id)
    await answer(req, () => this.gists.setSpeaker(req.member, id, memberId))
  }

  /** Take the microphone back; a speaker can also remove themselves. */
  @Delete(':id/speakers/:memberId')
  @HttpCode(204)
  async demote(@Req() req: AuthedRequest, @Param('id') id: string, @Param('memberId') memberId: string) {
    await answer(req, () => this.gists.demote(req.member, id, memberId))
  }

  /** Host only. */
  @Put(':id/cohosts/:memberId')
  @HttpCode(204)
  async addCohost(@Req() req: AuthedRequest, @Param('id') id: string, @Param('memberId') memberId: string) {
    await this.limits.hit('action', req.member.id)
    await answer(req, () => this.gists.setCohost(req.member, id, memberId))
  }

  @Post(':id/members/:memberId/mute')
  @HttpCode(204)
  async mute(@Req() req: AuthedRequest, @Param('id') id: string, @Param('memberId') memberId: string) {
    await answer(req, () => this.gists.mute(req.member, id, memberId))
  }

  @Delete(':id/members/:memberId')
  @HttpCode(204)
  async remove(@Req() req: AuthedRequest, @Param('id') id: string, @Param('memberId') memberId: string) {
    await answer(req, () => this.gists.remove(req.member, id, memberId))
  }

  /** Host only: lock the room, lower the cap, close requests. */
  @Patch(':id')
  async settings(@Req() req: AuthedRequest, @Param('id') id: string, @Body() body: unknown) {
    const settings = parse(settingsBody, body)
    return answer(req, () => this.gists.updateSettings(req.member, id, settings))
  }

  /** Host only. Ends the Gist for everyone. */
  @Post(':id/end')
  @HttpCode(204)
  async end(@Req() req: AuthedRequest, @Param('id') id: string) {
    await answer(req, () => this.gists.end(req.member, id))
  }
}

/**
 * LiveKit calls this when rooms and participants change. It carries no session:
 * the signature is the credential. The body is read raw (Content-Type
 * application/webhook+json, kept as a string in main.ts) because the signature
 * covers its exact bytes.
 */
@Controller('internal/livekit')
@UseGuards(LiveKitWebhookGuard)
export class LiveKitWebhookController {
  constructor(
    @Inject(ROOM_SERVICE) private readonly rooms: RoomService,
    @Inject(GistsService) private readonly gists: GistsService,
    @Inject(CallsService) private readonly calls: CallsService,
  ) {}

  @Post('webhook')
  @HttpCode(200)
  async webhook(@Body() body: unknown, @Headers('authorization') authorization: string | undefined) {
    if (typeof body !== 'string') throw new UnauthorizedException('bad signature')
    try {
      // Read and verified once; Gists and calls each ignore rooms that are not theirs.
      const event = await this.rooms.readWebhook(body, authorization)
      await this.gists.handleEvent(event)
      await this.calls.handleEvent(event)
    } catch (err) {
      if (err instanceof WebhookRejectedError) throw new UnauthorizedException('bad signature')
      throw err
    }
    return {}
  }
}
