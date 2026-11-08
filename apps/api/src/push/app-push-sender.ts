import type { PushDeviceService } from '@heynaija/db'
import type { Env } from '../env.js'
import { apnsSender } from './apns-sender.js'
import { fcmSender } from './fcm-sender.js'
import { type AppPushSender, type AppTarget, PermanentPushError, type PushMessage } from './push-sender.js'

/** Each installation's push sent through the sender for its push service. */
export class AppPushSenders implements AppPushSender {
  readonly services: readonly PushDeviceService[]

  constructor(private readonly senders: AppPushSender[]) {
    this.services = senders.flatMap((sender) => sender.services)
  }

  send(target: AppTarget, message: PushMessage): Promise<void> {
    const sender = this.senders.find((s) => s.services.includes(target.service))
    if (!sender) return Promise.reject(new PermanentPushError(`nothing here delivers to ${target.service}`))
    return sender.send(target, message)
  }
}

/**
 * The apps' push, through whichever services are configured: FCM for Android
 * (FCM_SERVICE_ACCOUNT, docs/adr/0023), APNs for iOS (the APPLE_* settings,
 * docs/adr/0026). Null with neither: the apps are not offered push.
 */
export function appPushSender(env: Pick<Env, 'FCM_SERVICE_ACCOUNT' | 'APPLE_TEAM_ID' | 'APPLE_KEY_ID' | 'APPLE_PRIVATE_KEY' | 'APPLE_BUNDLE_ID'>): AppPushSender | null {
  const senders = [fcmSender(env), apnsSender(env)].filter((sender) => sender !== null)
  if (senders.length > 1) return new AppPushSenders(senders)
  return senders[0] ?? null
}
