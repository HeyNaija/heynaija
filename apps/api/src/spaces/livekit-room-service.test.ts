import assert from 'node:assert/strict'
import { test } from 'node:test'
import { AccessToken, TokenVerifier, WebhookReceiver } from 'livekit-server-sdk'
import { LiveKitRoomService } from './livekit-room-service.js'
import { WebhookRejectedError } from './room-service.js'

const keys = { url: 'ws://127.0.0.1:7880', apiKey: 'devkey', apiSecret: 'a'.repeat(40), webhookKey: 'hookkey', webhookSecret: 'b'.repeat(40) }
const service = new LiveKitRoomService(keys)

test('a listener token joins one room as one identity, can subscribe, and can publish nothing', async () => {
  const jwt = await service.listenerToken('room-1', 'member-1', 'Ada')
  const claims = await new TokenVerifier(keys.apiKey, keys.apiSecret).verify(jwt)
  assert.equal(claims.sub, 'member-1')
  assert.equal(claims.name, 'Ada')
  const video = claims.video!
  assert.equal(video.roomJoin, true)
  assert.equal(video.room, 'room-1')
  assert.equal(video.canSubscribe, true)
  assert.equal(video.canPublish, false)
  assert.equal(video.canPublishData, false)
  assert.equal(video.hidden, true)
  assert.deepEqual(video.canPublishSources ?? [], [])
  assert.equal(video.roomAdmin, undefined)
  assert.equal(video.roomCreate, undefined)
})

test('the token is short-lived', async () => {
  const jwt = await service.listenerToken('room-1', 'member-1', 'Ada')
  const claims = await new TokenVerifier(keys.apiKey, keys.apiSecret).verify(jwt)
  const lifetime = claims.exp! - Math.floor(Date.now() / 1000)
  assert.ok(lifetime > 0 && lifetime <= 600, `ttl was ${lifetime}s`)
})

const signed = async (body: string, key: string, secret: string) => {
  const token = new AccessToken(key, secret)
  token.sha256 = Buffer.from(await crypto.subtle.digest('SHA-256', Buffer.from(body))).toString('base64')
  return token.toJwt()
}

test('webhooks are read only when signed with the webhook key', async () => {
  const body = JSON.stringify({ event: 'participant_joined', id: 'EV_1', createdAt: '1790000000', room: { name: 'room-1' }, participant: { identity: 'member-1' } })
  const event = await service.readWebhook(body, await signed(body, keys.webhookKey, keys.webhookSecret))
  assert.deepEqual({ ...event, at: undefined }, { id: 'EV_1', kind: 'participant_joined', room: 'room-1', identity: 'member-1', at: undefined })
  assert.equal(event.at.getTime(), 1_790_000_000_000)

  await assert.rejects(service.readWebhook(body, undefined), WebhookRejectedError)
  await assert.rejects(service.readWebhook(body, await signed(body, keys.webhookKey, 'c'.repeat(40))), WebhookRejectedError)
  // Signed for a different body.
  await assert.rejects(service.readWebhook(body + ' ', await signed(body, keys.webhookKey, keys.webhookSecret)), WebhookRejectedError)
  assert.ok(new WebhookReceiver(keys.webhookKey, keys.webhookSecret))
})

test('without a webhook key of its own the API key signs webhooks', async () => {
  const plain = new LiveKitRoomService({ url: keys.url, apiKey: keys.apiKey, apiSecret: keys.apiSecret })
  const body = JSON.stringify({ event: 'room_finished', id: 'EV_2', createdAt: '1790000000', room: { name: 'room-1' } })
  const event = await plain.readWebhook(body, await signed(body, keys.apiKey, keys.apiSecret))
  assert.equal(event.kind, 'room_finished')
})

test('a connection that started and never completed counts as the participant leaving', async () => {
  // Seen from a real LiveKit 1.13.11: a client that opens the signal socket and never finishes gets this, not participant_left.
  const body = JSON.stringify({ event: 'participant_connection_aborted', id: 'EV_3', createdAt: '1790000000', room: { name: 'room-1' }, participant: { identity: 'member-1' } })
  const event = await service.readWebhook(body, await signed(body, keys.webhookKey, keys.webhookSecret))
  assert.equal(event.kind, 'participant_left')
})
