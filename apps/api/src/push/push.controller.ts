import { Body, Controller, Delete, Get, HttpCode, Inject, Param, Post, Req, UseGuards } from '@nestjs/common'
import { z } from 'zod'
import { type AuthedRequest, SessionGuard, SuspendedAllowedGuard } from '../auth/session.guard.js'
import type { Env } from '../env.js'
import { parse } from '../http.js'
import { RateLimiter } from '../rate-limit.js'
import { ENV } from '../tokens.js'
import { PushNotificationsService } from './push-notifications.service.js'
import { isPushServiceUrl } from './push-sender.js'

/** base64url of `bytes` bytes, as browsers write a subscription's keys; some add `=` padding. */
const key = (bytes: number) =>
  z
    .string()
    .max(100)
    .transform((value) => value.replace(/=+$/, ''))
    .refine((value) => /^[\w-]+$/.test(value) && Buffer.from(value, 'base64url').length === bytes, `${bytes} bytes in base64url`)

const endpoint = (loopback: boolean) =>
  z
    .string()
    .max(2048)
    .refine((value) => isPushServiceUrl(value, loopback), 'not the address of a push service')

/** What `PushSubscription.toJSON()` gives in the browser, plus the address it replaces. */
const subscribeBody = (loopback: boolean) =>
  z.object({
    endpoint: endpoint(loopback),
    keys: z.object({ p256dh: key(65), auth: key(16) }),
    replaces: z.string().max(2048).optional(),
  })

const endpointBody = (loopback: boolean) => z.object({ endpoint: endpoint(loopback) })

/**
 * The browsers a member's notifications are pushed to. Settings subscribes and
 * unsubscribes the browser it is open in; every page load checks that the
 * browser's subscription is the signed-in member's; signing out removes it.
 */
@Controller('v1/push')
export class PushController {
  constructor(
    @Inject(PushNotificationsService) private readonly push: PushNotificationsService,
    @Inject(RateLimiter) private readonly limits: RateLimiter,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /** The key browsers subscribe with, or null when this server does not push. */
  @Get('key')
  key() {
    return { publicKey: this.push.publicKey }
  }

  /** Pushes the member's notifications to this browser from now on. Answers with the subscription's ID. */
  @Post('subscriptions')
  @UseGuards(SessionGuard)
  async subscribe(@Req() req: AuthedRequest, @Body() body: unknown) {
    const { endpoint, keys, replaces } = parse(subscribeBody(this.env.PUSH_ALLOW_LOOPBACK), body)
    await this.limits.hit('action', req.member.id)
    const id = await this.push.subscribe(req.member.id, { endpoint, p256dh: keys.p256dh, auth: keys.auth }, replaces)
    return { id }
  }

  /** Whether the member's notifications are pushed to this browser; someone else's stop being. */
  @Post('subscriptions/check')
  @HttpCode(200)
  @UseGuards(SessionGuard)
  async check(@Req() req: AuthedRequest, @Body() body: unknown) {
    const { endpoint } = parse(endpointBody(this.env.PUSH_ALLOW_LOOPBACK), body)
    return { subscribed: await this.push.isSubscribed(req.member.id, endpoint) }
  }

  /** Stops pushing to this browser. Suspended members can too, as they can sign out. */
  @Post('subscriptions/remove')
  @HttpCode(204)
  @UseGuards(SuspendedAllowedGuard)
  async unsubscribe(@Req() req: AuthedRequest, @Body() body: unknown) {
    const { endpoint } = parse(endpointBody(this.env.PUSH_ALLOW_LOOPBACK), body)
    await this.limits.hit('action', req.member.id)
    await this.push.unsubscribe(endpoint)
  }

  /** Signing out: stops pushing to the subscription the browser was given when it subscribed. */
  @Delete('subscriptions/:id')
  @HttpCode(204)
  @UseGuards(SuspendedAllowedGuard)
  async remove(@Req() req: AuthedRequest, @Param('id') id: string) {
    await this.push.remove(req.member.id, parse(z.uuid(), id))
  }
}
