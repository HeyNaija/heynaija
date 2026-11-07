import { PUSH_DEVICE_SERVICES } from '@heynaija/db'
import { Body, Controller, Delete, Get, HttpCode, Inject, NotFoundException, Param, Post, Req, UseGuards } from '@nestjs/common'
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

/** An installation of the app: its push service and the token that service gave it. */
const deviceBody = z.object({
  service: z.enum(PUSH_DEVICE_SERVICES),
  // FCM's tokens are some 160 characters of base64url with a colon.
  token: z.string().regex(/^[\w:.-]{32,4096}$/, 'a push token'),
})

/** Registering also gives the key the app made, that what is sent to it is sealed with. */
const registerBody = deviceBody.extend({ key: key(32) })

/**
 * The browsers a member's notifications are pushed to. Settings subscribes and
 * unsubscribes the browser it is open in; every page load checks that the
 * browser's subscription is the signed-in member's; signing out removes it. The
 * apps register in the same way under `devices` (docs/adr/0023).
 */
@Controller('v1/push')
export class PushController {
  constructor(
    @Inject(PushNotificationsService) private readonly push: PushNotificationsService,
    @Inject(RateLimiter) private readonly limits: RateLimiter,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /** The key browsers subscribe with, or null when this server does not push to browsers; and whether it pushes to the app. */
  @Get('key')
  key() {
    return { publicKey: this.push.publicKey, app: this.push.appsEnabled }
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

  /**
   * Pushes the member's notifications to this installation of the app from now on.
   * The app sends it whenever it starts signed in, and when its token changes.
   * 404 when this server cannot push to the app (no FCM service account).
   */
  @Post('devices')
  @HttpCode(204)
  @UseGuards(SessionGuard)
  async register(@Req() req: AuthedRequest, @Body() body: unknown) {
    if (!this.push.appsEnabled) throw new NotFoundException('This server does not push to the app')
    const { service, token, key } = parse(registerBody, body)
    await this.limits.hit('action', req.member.id)
    await this.push.register(req.member.id, service, token, key)
  }

  /** Signing out of the app: stops pushing to it. Suspended members can too, as they can sign out. */
  @Post('devices/remove')
  @HttpCode(204)
  @UseGuards(SuspendedAllowedGuard)
  async unregister(@Req() req: AuthedRequest, @Body() body: unknown) {
    const { service, token } = parse(deviceBody, body)
    await this.limits.hit('action', req.member.id)
    await this.push.unregister(req.member.id, service, token)
  }
}
