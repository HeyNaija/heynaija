import assert from 'node:assert/strict'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { after, before, test } from 'node:test'
import { KratosAddresses } from './addresses.js'

// A stand-in for Kratos's admin API: identities by ID, and what it answers to the rest.
const identities = new Map<string, { status?: number; body?: unknown }>()
let server: Server
let addresses: KratosAddresses

before(async () => {
  server = createServer((req, res) => {
    const id = req.url?.replace('/admin/identities/', '') ?? ''
    const answer = identities.get(id) ?? { status: 404 }
    res.writeHead(answer.status ?? 200, { 'content-type': 'application/json' })
    res.end(JSON.stringify(answer.body ?? {}))
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  addresses = new KratosAddresses(`http://127.0.0.1:${(server.address() as AddressInfo).port}`)
})
after(() => server.close())

const identity = (over: Record<string, unknown> = {}) => ({
  body: {
    state: 'active',
    traits: { email: 'Ada@Example.test', handle: 'ada' },
    verifiable_addresses: [{ value: 'ada@example.test', verified: true }],
    ...over,
  },
})

test('the address of an active member who has confirmed it', async () => {
  identities.set('a', identity())
  assert.equal(await addresses.addressFor('a'), 'Ada@Example.test')
})

test('no address worth writing to: unknown, deactivated, unconfirmed or missing', async () => {
  identities.set('deactivated', identity({ state: 'inactive' }))
  identities.set('unconfirmed', identity({ verifiable_addresses: [{ value: 'ada@example.test', verified: false }] }))
  identities.set('other-address', identity({ verifiable_addresses: [{ value: 'old@example.test', verified: true }] }))
  identities.set('no-list', identity({ verifiable_addresses: undefined }))
  identities.set('no-email', identity({ traits: { handle: 'ada' } }))
  for (const id of ['unknown', 'deactivated', 'unconfirmed', 'other-address', 'no-list', 'no-email']) {
    assert.equal(await addresses.addressFor(id), null, id)
  }
})

test('a Kratos that is in trouble is an error to retry, not "no address"', async () => {
  identities.set('broken', { status: 500 })
  await assert.rejects(addresses.addressFor('broken'))
  await assert.rejects(new KratosAddresses('http://127.0.0.1:1').addressFor('a'))
})
