// How a Gist's connection is doing, from the browser's WebRTC statistics, in words a
// member can act on. No browser APIs here, so tests/gist-connection.test.mjs covers
// it: app/ui/gists/audio.ts reads the statistics and the Connection sheet shows the
// summary. The same figures are what the Lagos measurement records
// (docs/deployment/livekit.md, "Measuring from Lagos").

/** LiveKit's view of a participant's connection (its ConnectionQuality), as plain strings. */
export type Quality = 'excellent' | 'good' | 'poor' | 'lost' | 'unknown'

/** Weak enough that people will hear it: the speaker's tile says so. */
export const weakQuality = (quality: Quality | undefined) => quality === 'poor' || quality === 'lost'

/** One RTCStats object, loosely typed: browsers differ in which fields they fill in. */
export type Stat = { type: string; id: string; [key: string]: unknown }

/**
 * How the media travels. UDP is best. TCP, and a relay reached over TCP or TLS, turn
 * every lost packet into a stall, which is how a voice starts to sound robotic.
 */
export type Route = 'udp' | 'tcp' | 'relay-udp' | 'relay-tcp' | 'unknown'

/** One reading. The counters are running totals: two readings give the change between them. */
export type Sample = {
  route: Route
  rttMs: number | null
  /** Audio coming in: packets received and lost, and samples the browser had to make up. */
  received: number
  lost: number
  concealed: number
  samples: number
  /** The worst jitter among the incoming streams. */
  jitterMs: number | null
  /** Audio going out (a speaker): the share the server reports lost, 0..1. */
  sentLoss: number | null
}

export type Verdict = 'good' | 'fair' | 'poor' | 'unknown'

export type Summary = {
  route: Route
  rttMs: number | null
  lossPercent: number | null
  jitterMs: number | null
  concealedPercent: number | null
  verdict: Verdict
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)

/** The candidate pair the connection is using: the transport names it in Chrome and Safari, Firefox marks it `selected`. */
function selectedPair(stats: Stat[]): Stat | undefined {
  const pairs = stats.filter((s) => s.type === 'candidate-pair')
  const named = stats.find((s) => s.type === 'transport' && typeof s.selectedCandidatePairId === 'string')?.selectedCandidatePairId
  return pairs.find((p) => p.id === named) ?? pairs.find((p) => p.selected === true) ?? pairs.find((p) => p.nominated === true && p.state === 'succeeded')
}

function routeOf(pair: Stat | undefined, stats: Stat[]): Route {
  const local = pair && stats.find((s) => s.id === pair.localCandidateId)
  if (!local) return 'unknown'
  if (local.candidateType === 'relay') return local.relayProtocol === 'udp' ? 'relay-udp' : 'relay-tcp'
  if (local.protocol === 'udp') return 'udp'
  if (local.protocol === 'tcp') return 'tcp'
  return 'unknown'
}

/** Reads one sample from every statistic the room's tracks report, merged by id. */
export function readSample(stats: Stat[]): Sample {
  const pair = selectedPair(stats)
  const inbound = stats.filter((s) => s.type === 'inbound-rtp' && s.kind === 'audio')
  const remoteIn = stats.filter((s) => s.type === 'remote-inbound-rtp' && s.kind === 'audio')
  const sum = (list: Stat[], key: string) => list.reduce((n, s) => n + (num(s[key]) ?? 0), 0)
  const jitters = inbound.map((s) => num(s.jitter)).filter((j): j is number => j !== null)
  const pairRtt = num(pair?.currentRoundTripTime)
  const remoteRtt = remoteIn.map((s) => num(s.roundTripTime)).find((r) => r !== null) ?? null
  const rtt = pairRtt ?? remoteRtt
  const sentLosses = remoteIn.map((s) => num(s.fractionLost)).filter((f): f is number => f !== null)
  return {
    route: routeOf(pair, stats),
    rttMs: rtt === null ? null : Math.round(rtt * 1000),
    received: sum(inbound, 'packetsReceived'),
    lost: Math.max(0, sum(inbound, 'packetsLost')),
    // Silence that DTX left out is filled in on purpose, not because anything was lost.
    concealed: Math.max(0, sum(inbound, 'concealedSamples') - sum(inbound, 'silentConcealedSamples')),
    samples: sum(inbound, 'totalSamplesReceived'),
    jitterMs: jitters.length ? Math.round(Math.max(...jitters) * 1000) : null,
    sentLoss: sentLosses.length ? Math.max(...sentLosses) : null,
  }
}

/** Too few packets in a gap (silence, with DTX) say nothing about loss. */
const MIN_PACKETS = 25

/** The change since the last sample when there is enough of it, else the running totals. */
function ratio(part: number, whole: number, prevPart: number, prevWhole: number): number | null {
  const dPart = part - prevPart
  const dWhole = whole - prevWhole
  if (dWhole >= MIN_PACKETS && dPart >= 0) return (dPart / dWhole) * 100
  if (whole >= MIN_PACKETS) return (part / whole) * 100
  return null
}

export function verdictOf(s: Omit<Summary, 'verdict'>): Verdict {
  const { lossPercent: loss, jitterMs: jitter, rttMs: rtt, concealedPercent: concealed } = s
  if (loss === null && jitter === null && rtt === null && concealed === null) return 'unknown'
  if ((loss ?? 0) >= 5 || (jitter ?? 0) >= 60 || (rtt ?? 0) >= 500 || (concealed ?? 0) >= 10) return 'poor'
  if ((loss ?? 0) >= 2 || (jitter ?? 0) >= 30 || (rtt ?? 0) >= 300 || (concealed ?? 0) >= 3 || s.route === 'tcp' || s.route === 'relay-tcp') return 'fair'
  return 'good'
}

/** What the connection has been doing since the previous sample (or since it began, for the first). */
export function summarize(prev: Sample | null, now: Sample): Summary {
  const p = prev ?? { received: 0, lost: 0, concealed: 0, samples: 0 }
  const inLoss = ratio(now.lost, now.received + now.lost, p.lost, p.received + p.lost)
  const outLoss = now.sentLoss === null ? null : now.sentLoss * 100
  const lossPercent = inLoss === null && outLoss === null ? null : Math.max(inLoss ?? 0, outLoss ?? 0)
  const concealedPercent = ratio(now.concealed, now.samples, p.concealed, p.samples)
  const base = { route: now.route, rttMs: now.rttMs, lossPercent, jitterMs: now.jitterMs, concealedPercent }
  return { ...base, verdict: verdictOf(base) }
}

export const routeText: Record<Route, string> = {
  udp: 'UDP (best)',
  tcp: 'TCP',
  'relay-udp': 'Relay, over UDP',
  'relay-tcp': 'Relay, over TCP',
  unknown: '–',
}

/** Said under the figures when the route itself makes the sound worse. */
export function routeNote(route: Route): string | null {
  if (route !== 'tcp' && route !== 'relay-tcp') return null
  return 'This network blocks the faster route, so any lost data makes the sound stall. Mobile data or another Wi-Fi may do better.'
}

export function verdictText(verdict: Verdict, speaker: boolean): string {
  if (verdict === 'good') return 'Your connection is good. If someone sounds unclear, the problem is likely at their end.'
  if (verdict === 'fair') return 'Your connection is fair. You may hear the odd break in the sound.'
  if (verdict === 'poor') {
    return `Your connection is weak, so the sound may break up${speaker ? ' and others may not hear you clearly' : ''}. Move closer to your Wi-Fi, or switch between Wi-Fi and mobile data.`
  }
  return 'Measuring…'
}

export const msText = (ms: number | null) => (ms === null ? '–' : `${ms} ms`)
export const percentText = (p: number | null) => (p === null ? '–' : `${p < 10 ? p.toFixed(1) : Math.round(p)}%`)

/** One line to paste into the measurement sheet. `network` is the browser's guess at the connection type, if it has one. */
export function measurementLine(s: Summary, network?: string): string {
  const fixed = (p: number | null) => (p === null ? '-' : p.toFixed(1))
  return [
    `route=${s.route}`,
    `rtt=${s.rttMs ?? '-'}ms`,
    `loss=${fixed(s.lossPercent)}%`,
    `jitter=${s.jitterMs ?? '-'}ms`,
    `concealed=${fixed(s.concealedPercent)}%`,
    `verdict=${s.verdict}`,
    ...(network ? [`network=${network}`] : []),
  ].join(' ')
}
