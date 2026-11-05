import assert from 'node:assert/strict'
import { test } from 'node:test'
import { measurementLine, readSample, routeNote, summarize, verdictOf, verdictText, weakQuality } from '../lib/gist-connection.ts'

/** The statistics Chrome reports for a listener hearing one speaker over UDP. */
function chromeListener({ received = 1000, lost = 0, jitter = 0.012, rtt = 0.14, concealed = 0, silent = 0, samples = 480_000, candidate = {} } = {}) {
  return [
    { type: 'transport', id: 'T1', selectedCandidatePairId: 'CP1' },
    { type: 'candidate-pair', id: 'CP0', localCandidateId: 'L0', state: 'failed' },
    { type: 'candidate-pair', id: 'CP1', localCandidateId: 'L1', state: 'succeeded', nominated: true, currentRoundTripTime: rtt },
    { type: 'local-candidate', id: 'L0', candidateType: 'host', protocol: 'tcp' },
    { type: 'local-candidate', id: 'L1', candidateType: 'srflx', protocol: 'udp', ...candidate },
    {
      type: 'inbound-rtp',
      id: 'IA',
      kind: 'audio',
      packetsReceived: received,
      packetsLost: lost,
      jitter,
      concealedSamples: concealed,
      silentConcealedSamples: silent,
      totalSamplesReceived: samples,
    },
  ]
}

test('the route is the selected pair: UDP, TCP, or a relay and how it is reached', () => {
  assert.equal(readSample(chromeListener()).route, 'udp')
  assert.equal(readSample(chromeListener({ candidate: { protocol: 'tcp' } })).route, 'tcp')
  assert.equal(readSample(chromeListener({ candidate: { candidateType: 'relay', relayProtocol: 'udp' } })).route, 'relay-udp')
  // TURN on 443 is TLS: as bad as TCP for audio.
  assert.equal(readSample(chromeListener({ candidate: { candidateType: 'relay', relayProtocol: 'tls' } })).route, 'relay-tcp')
  assert.equal(readSample([]).route, 'unknown')
})

test('Firefox marks the pair it uses as selected, with no transport statistic', () => {
  const stats = chromeListener().filter((s) => s.type !== 'transport')
  stats[2] = { ...stats[2], nominated: false, selected: true }
  assert.equal(readSample(stats).route, 'udp')
})

test('round trip and jitter come out in milliseconds', () => {
  const s = readSample(chromeListener({ rtt: 0.1834, jitter: 0.0216 }))
  assert.equal(s.rttMs, 183)
  assert.equal(s.jitterMs, 22)
})

test('loss is over the last interval when it has enough packets, so an old bad patch does not linger', () => {
  const before = readSample(chromeListener({ received: 1000, lost: 200 }))
  const after = readSample(chromeListener({ received: 1100, lost: 200 }))
  assert.equal(summarize(before, after).lossPercent, 0)
  // The first reading has nothing before it: the running totals.
  assert.equal(Math.round(summarize(null, before).lossPercent), 17)
})

test('a quiet interval (DTX sends next to nothing) falls back to the running totals', () => {
  const before = readSample(chromeListener({ received: 1000, lost: 10 }))
  const after = readSample(chromeListener({ received: 1005, lost: 10 }))
  assert.equal(summarize(before, after).lossPercent.toFixed(2), (10 / 1015 * 100).toFixed(2))
})

test('silence that DTX left out is not counted as sound filled in', () => {
  const s = summarize(null, readSample(chromeListener({ concealed: 9600, silent: 9600, samples: 480_000 })))
  assert.equal(s.concealedPercent, 0)
})

test('a speaker hears about their own outgoing loss from the server', () => {
  const stats = [
    { type: 'transport', id: 'T1', selectedCandidatePairId: 'CP1' },
    { type: 'candidate-pair', id: 'CP1', localCandidateId: 'L1', currentRoundTripTime: 0.2 },
    { type: 'local-candidate', id: 'L1', candidateType: 'host', protocol: 'udp' },
    { type: 'remote-inbound-rtp', id: 'RI', kind: 'audio', fractionLost: 0.08, roundTripTime: 0.21 },
  ]
  const s = summarize(null, readSample(stats))
  assert.equal(s.lossPercent, 8)
  assert.equal(s.verdict, 'poor')
})

test('verdicts: good, fair on a stalling route or moderate loss, poor on heavy loss or delay', () => {
  const base = { route: 'udp', rttMs: 120, lossPercent: 0.5, jitterMs: 10, concealedPercent: 0.2 }
  assert.equal(verdictOf(base), 'good')
  assert.equal(verdictOf({ ...base, route: 'relay-tcp' }), 'fair')
  assert.equal(verdictOf({ ...base, lossPercent: 3 }), 'fair')
  assert.equal(verdictOf({ ...base, lossPercent: 6 }), 'poor')
  assert.equal(verdictOf({ ...base, rttMs: 650 }), 'poor')
  assert.equal(verdictOf({ route: 'unknown', rttMs: null, lossPercent: null, jitterMs: null, concealedPercent: null }), 'unknown')
})

test('words: a weak connection says what to try, and a speaker hears that others are affected', () => {
  assert.match(verdictText('poor', true), /others may not hear you clearly/)
  assert.doesNotMatch(verdictText('poor', false), /others/)
  assert.match(routeNote('relay-tcp'), /blocks the faster route/)
  assert.equal(routeNote('udp'), null)
})

test('only poor and lost connections are called weak', () => {
  assert.equal(weakQuality('poor'), true)
  assert.equal(weakQuality('lost'), true)
  for (const q of ['excellent', 'good', 'unknown', undefined]) assert.equal(weakQuality(q), false)
})

test('the measurement line has every figure, and the network type when the browser gives one', () => {
  const line = measurementLine({ route: 'udp', rttMs: 142, lossPercent: 0.44, jitterMs: 12, concealedPercent: null, verdict: 'good' }, '4g')
  assert.equal(line, 'route=udp rtt=142ms loss=0.4% jitter=12ms concealed=-% verdict=good network=4g')
})
