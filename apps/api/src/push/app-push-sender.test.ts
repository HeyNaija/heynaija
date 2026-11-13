import assert from 'node:assert/strict'
import { generateKeyPairSync } from 'node:crypto'
import { test } from 'node:test'
import type { PushDeviceService } from '@heynaija/db'
import { AppPushSenders, appPushSender } from './app-push-sender.js'
import { ApnsSender } from './apns-sender.js'
import { FcmSender } from './fcm-sender.js'
import { type AppPushSender, type AppTarget, PermanentPushError } from './push-sender.js'

const message = { title: 'hi', body: '', url: '/notifications', tag: 'follow' }
const target = (service: PushDeviceService): AppTarget => ({ service, token: `${service}-token`, key: Buffer.alloc(32).toString('base64url'), memberId: 'm' })

class Recording implements AppPushSender {
  sent: string[] = []
  constructor(readonly services: readonly PushDeviceService[]) {}
  async send(t: AppTarget) {
    this.sent.push(t.token)
  }
}

test('each installation is sent through the sender for its push service', async () => {
  const fcm = new Recording(['fcm'])
  const apns = new Recording(['apns', 'apns_sandbox'])
  const both = new AppPushSenders([fcm, apns])
  assert.deepEqual(both.services, ['fcm', 'apns', 'apns_sandbox'])
  await both.send(target('apns_sandbox'), message)
  await both.send(target('fcm'), message)
  assert.deepEqual(fcm.sent, ['fcm-token'])
  assert.deepEqual(apns.sent, ['apns_sandbox-token'])
  await assert.rejects(new AppPushSenders([fcm]).send(target('apns'), message), PermanentPushError)
})

test('the apps’ push is whichever services are configured', () => {
  const rsa = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()
  const ec = generateKeyPairSync('ec', { namedCurve: 'P-256' }).privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()
  const fcm = { FCM_SERVICE_ACCOUNT: { projectId: 'heynaija-test', clientEmail: 'a@b.iam.gserviceaccount.com', privateKey: rsa } }
  const apple = { APPLE_TEAM_ID: 'TEAM123456', APPLE_KEY_ID: 'KEY1234567', APPLE_PRIVATE_KEY: ec }
  const bundle = { APPLE_BUNDLE_ID: 'ng.heynaija.app' }
  assert.equal(appPushSender(bundle), null)
  assert.ok(appPushSender({ ...bundle, ...fcm }) instanceof FcmSender)
  assert.ok(appPushSender({ ...bundle, ...apple }) instanceof ApnsSender)
  assert.deepEqual(appPushSender({ ...bundle, ...fcm, ...apple })?.services, ['fcm', 'apns', 'apns_sandbox'])
})
