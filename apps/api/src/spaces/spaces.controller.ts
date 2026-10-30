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
import { WebhookRejectedError } from './room-service.js'
import { SpaceError, SpacesService } from './spaces.service.js'
import { SpacesEnabledGuard, routeNotFound } from './spaces-enabled.guard.js'

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
    if (!(err instanceof SpaceError)) throw err
    if (err.code === 'not_found') throw routeNotFound(req)
    throw new HttpException({ code: err.code, message: err.message === err.code ? messages[err.code] : err.message }, err.status)
  }
}

const messages: Record<SpaceError['code'], string> = {
  not_found: 'Not found',
  forbidden: 'Only the host or a co-host can do that.',
  invalid: 'That is not allowed.',
  space_full: 'This Space is full.',
  space_locked: 'The host has locked this Space.',
  space_ended: 'This Space has ended.',
  already_hosting: 'You are already hosting a live Space.',
  speakers_full: 'There is no room for more speakers.',
  cohosts_full: 'There is no room for more co-hosts.',
  requests_closed: 'The host is not taking requests to speak.',
  not_in_space: 'Join the Space first.',
  not_eligible: 'That member cannot be given the microphone.',
  already_speaker: 'You are already on the stage.',
  livekit_unavailable: 'The audio service is not available. Try again in a moment.',
}

@Controller('v1/spaces')
@UseGuards(SpacesEnabledGuard, SessionGuard)
export class SpacesController {
  constructor(
    @Inject(SpacesService) private readonly spaces: SpacesService,
    @Inject(RateLimiter) private readonly limits: RateLimiter,
  ) {}

  /** Starts a Space now, with the caller as host. */
  @Post()
  async create(@Req() req: AuthedRequest, @Body() body: unknown) {
    const input = parse(createBody, body)
    await this.limits.hit('spaceCreate', req.member.id)
    return answer(req, () => this.spaces.create(req.member, input))
  }

  @Get(':id')
  get(@Req() req: AuthedRequest, @Param('id') id: string) {
    return answer(req, () => this.spaces.get(req.member, id))
  }

  /** A listener token and the role the member has. Also the reconnect call. */
  @Post(':id/join')
  @HttpCode(200)
  async join(@Req() req: AuthedRequest, @Param('id') id: string) {
    await this.limits.hit('spaceJoin', req.member.id)
    await this.limits.hit('spaceJoinBurst', id)
    return answer(req, () => this.spaces.join(req.member, id))
  }

  @Post(':id/leave')
  @HttpCode(204)
  async leave(@Req() req: AuthedRequest, @Param('id') id: string) {
    await answer(req, () => this.spaces.leave(req.member, id))
  }

  /** Once connected: reset my LiveKit permissions to my role. */
  @Post(':id/sync')
  @HttpCode(200)
  sync(@Req() req: AuthedRequest, @Param('id') id: string) {
    return answer(req, () => this.spaces.sync(req.member, id))
  }

  @Put(':id/speak-request')
  @HttpCode(204)
  async request(@Req() req: AuthedRequest, @Param('id') id: string) {
    await this.limits.hit('spaceRequest', req.member.id)
    await answer(req, () => this.spaces.requestToSpeak(req.member, id))
  }

  @Delete(':id/speak-request')
  @HttpCode(204)
  async cancelRequest(@Req() req: AuthedRequest, @Param('id') id: string) {
    await answer(req, () => this.spaces.cancelRequest(req.member, id))
  }

  /** Host and co-hosts: the queue of requests to speak, oldest first. */
  @Get(':id/requests')
  async requests(@Req() req: AuthedRequest, @Param('id') id: string) {
    return { items: await answer(req, () => this.spaces.requests(req.member, id)) }
  }

  /** Host and co-hosts: who is listening. */
  @Get(':id/listeners')
  async listeners(@Req() req: AuthedRequest, @Param('id') id: string) {
    return { items: await answer(req, () => this.spaces.listeners(req.member, id)) }
  }

  /** Approve a request, or invite a listener to speak. */
  @Put(':id/speakers/:memberId')
  @HttpCode(204)
  async addSpeaker(@Req() req: AuthedRequest, @Param('id') id: string, @Param('memberId') memberId: string) {
    await this.limits.hit('action', req.member.id)
    await answer(req, () => this.spaces.setSpeaker(req.member, id, memberId))
  }

  /** Take the microphone back; a speaker can also remove themselves. */
  @Delete(':id/speakers/:memberId')
  @HttpCode(204)
  async demote(@Req() req: AuthedRequest, @Param('id') id: string, @Param('memberId') memberId: string) {
    await answer(req, () => this.spaces.demote(req.member, id, memberId))
  }

  /** Host only. */
  @Put(':id/cohosts/:memberId')
  @HttpCode(204)
  async addCohost(@Req() req: AuthedRequest, @Param('id') id: string, @Param('memberId') memberId: string) {
    await this.limits.hit('action', req.member.id)
    await answer(req, () => this.spaces.setCohost(req.member, id, memberId))
  }

  @Post(':id/members/:memberId/mute')
  @HttpCode(204)
  async mute(@Req() req: AuthedRequest, @Param('id') id: string, @Param('memberId') memberId: string) {
    await answer(req, () => this.spaces.mute(req.member, id, memberId))
  }

  @Delete(':id/members/:memberId')
  @HttpCode(204)
  async remove(@Req() req: AuthedRequest, @Param('id') id: string, @Param('memberId') memberId: string) {
    await answer(req, () => this.spaces.remove(req.member, id, memberId))
  }

  /** Host only: lock the room, lower the cap, close requests. */
  @Patch(':id')
  async settings(@Req() req: AuthedRequest, @Param('id') id: string, @Body() body: unknown) {
    const settings = parse(settingsBody, body)
    return answer(req, () => this.spaces.updateSettings(req.member, id, settings))
  }

  /** Host only. Ends the Space for everyone. */
  @Post(':id/end')
  @HttpCode(204)
  async end(@Req() req: AuthedRequest, @Param('id') id: string) {
    await answer(req, () => this.spaces.end(req.member, id))
  }
}

/**
 * LiveKit calls this when rooms and participants change. It carries no session:
 * the signature is the credential. The body is read raw (Content-Type
 * application/webhook+json, kept as a string in main.ts) because the signature
 * covers its exact bytes.
 */
@Controller('internal/livekit')
@UseGuards(SpacesEnabledGuard)
export class LiveKitWebhookController {
  constructor(@Inject(SpacesService) private readonly spaces: SpacesService) {}

  @Post('webhook')
  @HttpCode(200)
  async webhook(@Body() body: unknown, @Headers('authorization') authorization: string | undefined) {
    if (typeof body !== 'string') throw new UnauthorizedException('bad signature')
    try {
      await this.spaces.handleWebhook(body, authorization)
    } catch (err) {
      if (err instanceof WebhookRejectedError) throw new UnauthorizedException('bad signature')
      throw err
    }
    return {}
  }
}
