// Pure rules for a speaker's microphone and for how the room talks about who is
// speaking. No browser APIs here, so tests/space-mic.test.mjs covers them.
//
// The audio path stays a clean pass-through: only the browser's own processing
// switches (noise suppression, echo cancellation, auto gain) are offered. There is
// deliberately no pitch shifting or voice changing (ADR 0017, open question 20).

export type MicSettings = {
  /** null: the browser's default input. */
  deviceId: string | null
  noiseSuppression: boolean
  echoCancellation: boolean
  autoGainControl: boolean
}

export const DEFAULT_MIC: MicSettings = { deviceId: null, noiseSuppression: true, echoCancellation: true, autoGainControl: true }
export const MIC_SETTINGS_KEY = 'hn-space-mic'

/** Settings saved in localStorage; anything missing, mistyped or corrupt falls back to the defaults. */
export function readMicSettings(raw: string | null): MicSettings {
  if (!raw) return { ...DEFAULT_MIC }
  try {
    const v = JSON.parse(raw) as Partial<Record<keyof MicSettings, unknown>> | null
    const flag = (x: unknown, fallback: boolean) => (typeof x === 'boolean' ? x : fallback)
    return {
      deviceId: typeof v?.deviceId === 'string' && v.deviceId ? v.deviceId : null,
      noiseSuppression: flag(v?.noiseSuppression, true),
      echoCancellation: flag(v?.echoCancellation, true),
      autoGainControl: flag(v?.autoGainControl, true),
    }
  } catch {
    return { ...DEFAULT_MIC }
  }
}

export const writeMicSettings = (settings: MicSettings) => JSON.stringify(settings)

export type InputDevice = { deviceId: string; label: string }

/**
 * Which input to use: the one the member chose if it is still plugged in, else the
 * browser's default, else the first there is. `fellBack` is true when the chosen
 * one is gone (unplugged), so the room can say so; `none` when there is no input.
 */
export function chooseDevice(devices: InputDevice[], wanted: string | null): { deviceId: string | null; fellBack: boolean; none: boolean } {
  if (devices.length === 0) return { deviceId: null, fellBack: false, none: true }
  if (wanted === null) return { deviceId: null, fellBack: false, none: false }
  if (devices.some((d) => d.deviceId === wanted)) return { deviceId: wanted, fellBack: false, none: false }
  return { deviceId: null, fellBack: true, none: false }
}

/** Browsers hide labels until the microphone has been allowed once. */
export const deviceLabel = (device: InputDevice, index: number) => device.label.trim() || `Microphone ${index + 1}`

export type MicPlan = 'publish' | 'unmute' | 'restart' | 'none'

/**
 * What to do with the microphone track. LiveKit keeps a publication after the first
 * Unmute, and unmuting it ignores new capture options, so a device or switch changed
 * while muted needs a restart before the unmute. `appliedKey` is what the live track
 * was last started with ('' when there is none).
 */
export function micPlan(s: { appliedKey: string; key: string; hasPublication: boolean; isMuted: boolean; wantOn: boolean }): MicPlan {
  if (!s.wantOn) return 'none'
  if (!s.hasPublication) return 'publish'
  if (s.appliedKey !== s.key) return 'restart'
  return s.isMuted ? 'unmute' : 'none'
}

/** A restart that fails stops the old track first, so nothing usable is left: forget it, and the next Unmute starts afresh. */
export const afterFailedRestart = () => ({ appliedKey: '', hasPublication: false })

export type MicFailure = { kind: 'denied' | 'none' | 'busy' | 'other'; message: string }

/** Plain words for what went wrong turning the microphone on, and what to do next. */
export function micFailure(error: unknown): MicFailure {
  const name = (error as { name?: string } | null)?.name
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return {
      kind: 'denied',
      message: 'The browser is blocking the microphone, so you are still listening. Allow the microphone for this site (the lock or tune icon beside the address), then tap Unmute.',
    }
  }
  if (name === 'NotFoundError' || name === 'OverconstrainedError') {
    return { kind: 'none', message: 'No microphone was found. Plug one in or connect a headset, then tap Unmute. You can keep listening meanwhile.' }
  }
  if (name === 'NotReadableError' || name === 'AbortError') {
    return { kind: 'busy', message: 'The microphone did not start. Another app may be using it. Close that app, then tap Unmute. You are still listening.' }
  }
  return { kind: 'other', message: 'The microphone did not start. Try again. You are still listening.' }
}

/** Loudness of a block of samples (-1..1) as 0..1 on a decibel scale, so quiet speech still moves the meter. */
export function rmsLevel(samples: ArrayLike<number>): number {
  if (samples.length === 0) return 0
  let sum = 0
  for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i]
  const rms = Math.sqrt(sum / samples.length)
  if (rms <= 0) return 0
  const db = 20 * Math.log10(rms)
  return Math.min(1, Math.max(0, (db + 60) / 60))
}

/** A meter that jumps up quickly and falls back slowly, so it is readable and not a flicker. */
export function smoothLevel(previous: number, next: number, attack = 0.6, release = 0.12): number {
  const k = next > previous ? attack : release
  const value = previous + (next - previous) * k
  return value < 0.005 ? 0 : value
}

/**
 * Throttled "who is speaking" for the screen-reader live region. It speaks up when
 * someone new starts, at most once per `minGapMs`, never lists more than two names,
 * and does not repeat while the same people keep talking. Speaking that starts in
 * a throttled gap is skipped, not queued: a late announcement would be wrong.
 */
export function createSpeakingAnnouncer(minGapMs = 6000) {
  let before = new Set<string>()
  let lastAt = -Infinity
  return {
    next(now: number, speakingIds: string[], nameOf: (id: string) => string | null): string | null {
      const current = new Set(speakingIds)
      const started = speakingIds.filter((id) => !before.has(id))
      before = current
      if (started.length === 0 || now - lastAt < minGapMs) return null
      const names = started.map(nameOf).filter((n): n is string => Boolean(n))
      if (names.length === 0) return null
      lastAt = now
      if (names.length === 1) return `${names[0]} is speaking.`
      if (names.length === 2) return `${names[0]} and ${names[1]} are speaking.`
      return 'Several people are speaking.'
    },
  }
}

/** "12:03" under an hour, "1:02:03" after. Empty before the Space has started. */
export function elapsedLabel(startedAt: string | null, now: number): string {
  if (!startedAt) return ''
  const seconds = Math.max(0, Math.floor((now - Date.parse(startedAt)) / 1000))
  if (Number.isNaN(seconds)) return ''
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = seconds % 60
  const two = (n: number) => String(n).padStart(2, '0')
  return h > 0 ? `${h}:${two(m)}:${two(s)}` : `${m}:${two(s)}`
}
