// Noise removal for a speaker's microphone: RNNoise (xiph/rnnoise, through
// @sapphi-red/web-noise-suppressor) in an AudioWorklet, as a LiveKit track processor.
// It runs on the device, after the browser's own echo cancellation, noise suppression
// and auto gain and before the sound is encoded. It takes out background noise (a
// generator, traffic, people nearby) and never changes how the voice itself sounds
// (ADR 0017, open question 20). Only audio.ts imports this, so it loads with the SDK.
//
// RNNoise works on 48 kHz audio. Where the room's audio runs at another rate, or the
// browser lacks AudioWorklet or WebAssembly, or the files cannot be fetched, the
// processor passes the microphone through untouched: it never stops a speaker being heard.
import type { RnnoiseWorkletNode } from '@sapphi-red/web-noise-suppressor'
import type { AudioProcessorOptions, Track, TrackProcessor } from 'livekit-client'
import { canRemoveNoise } from '@/lib/gist-mic'

export const NOISE_PROCESSOR = 'rnnoise'

// Fingerprinted files under /_next/static, fetched only when a speaker turns noise removal on.
const workletUrl = new URL('@sapphi-red/web-noise-suppressor/rnnoiseWorklet.js', import.meta.url).href
const wasmUrl = new URL('@sapphi-red/web-noise-suppressor/rnnoise.wasm', import.meta.url).href
const simdUrl = new URL('@sapphi-red/web-noise-suppressor/rnnoise_simd.wasm', import.meta.url).href

// The model is fetched once per page; a failed fetch is forgotten so the next Unmute tries again.
let wasm: Promise<ArrayBuffer> | null = null
const withWorklet = new WeakSet<BaseAudioContext>()

/**
 * The library, the model and the worklet, ready on `ctx`. The library is imported here, not at the
 * top: it subclasses AudioWorkletNode as it loads, which would throw on a browser without
 * AudioWorklet and take the whole room's audio down with it.
 */
async function prepare(ctx: AudioContext) {
  const lib = await import('@sapphi-red/web-noise-suppressor')
  wasm ??= lib.loadRnnoise({ url: wasmUrl, simdUrl }).catch((err: unknown) => {
    wasm = null
    throw err
  })
  const wasmBinary = await wasm
  if (!withWorklet.has(ctx)) {
    await ctx.audioWorklet.addModule(workletUrl)
    withWorklet.add(ctx)
  }
  return new lib.RnnoiseWorkletNode(ctx, { maxChannels: 1, wasmBinary })
}

/**
 * A processor for one microphone track. `onActive` says whether RNNoise is running
 * (false when it fell back to the plain microphone), for the settings sheet.
 */
export function createNoiseRemoval(onActive: (active: boolean) => void): TrackProcessor<Track.Kind.Audio, AudioProcessorOptions> {
  let graph: { source: MediaStreamAudioSourceNode; node: RnnoiseWorkletNode; out: MediaStreamAudioDestinationNode } | null = null

  const teardown = () => {
    if (!graph) return
    graph.source.disconnect()
    graph.node.disconnect()
    graph.node.destroy()
    graph.out.stream.getTracks().forEach((t) => t.stop())
    graph = null
  }

  const processor: TrackProcessor<Track.Kind.Audio, AudioProcessorOptions> = {
    name: NOISE_PROCESSOR,
    processedTrack: undefined,
    async init({ track, audioContext: ctx }) {
      teardown()
      processor.processedTrack = undefined
      const supported =
        Boolean(ctx) && canRemoveNoise({ sampleRate: ctx.sampleRate, audioWorklet: 'audioWorklet' in ctx, webAssembly: typeof WebAssembly === 'object' })
      if (!supported) return onActive(false)
      try {
        // A suspended graph would send silence in place of the voice: only build on a running one.
        if (ctx.state !== 'running') await ctx.resume()
        if (ctx.state !== 'running') return onActive(false)
        const node = await prepare(ctx)
        const source = ctx.createMediaStreamSource(new MediaStream([track]))
        const out = ctx.createMediaStreamDestination()
        out.channelCount = 1
        source.connect(node).connect(out)
        graph = { source, node, out }
        processor.processedTrack = out.stream.getAudioTracks()[0]
        onActive(true)
      } catch {
        teardown()
        processor.processedTrack = undefined
        onActive(false)
      }
    },
    // A new microphone track (Unmute, a device change) or a new audio context: build again around it.
    restart: (opts) => processor.init(opts),
    async destroy() {
      teardown()
      processor.processedTrack = undefined
      onActive(false)
    },
  }
  return processor
}
