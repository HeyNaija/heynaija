// What the system's media controls show for a Gist (the Media Session API), and the
// silent sound that puts it there. No browser APIs here, so tests/gist-media.test.mjs
// covers it; app/ui/gists/gist-provider.tsx does the rest.
//
// Browsers do not give a call's WebRTC sound a place in their media controls (the lock
// screen, the notification shade, a keyboard's media keys, Chrome's media button): only an
// ordinary <audio> element of some length gets one. So while the member is in a Gist the
// page plays a few seconds of silence on a loop, and the controls act on the Gist.
import { personName, type GistView } from './gists.ts'

export const GIST_ALBUM = 'HeyNaija Gists'

/** The app's icon, which stands in for cover art. */
export const GIST_ARTWORK = [
  { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
  { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
]

/** The title and the line under it: the Gist and who hosts it, or what the member's connection or microphone is doing. */
export function gistMediaText(view: Pick<GistView, 'title' | 'host'>, s: { micOn: boolean; reconnecting: boolean }) {
  const artist = s.reconnecting ? 'Reconnecting…' : s.micOn ? 'Your microphone is on' : `Hosted by ${personName(view.host)}`
  return { title: view.title, artist, album: GIST_ALBUM }
}

/**
 * A WAV file of silence: 8-bit mono PCM at 8 kHz, 8 KB a second. Ten seconds is past the
 * five that browsers want before they treat a sound as something to control, not a beep.
 */
export function silentWav(seconds = 10, rate = 8000): Uint8Array<ArrayBuffer> {
  const samples = Math.round(seconds * rate)
  const bytes = new Uint8Array(44 + samples)
  const data = new DataView(bytes.buffer)
  const text = (at: number, s: string) => {
    for (let i = 0; i < s.length; i++) bytes[at + i] = s.charCodeAt(i)
  }
  text(0, 'RIFF')
  data.setUint32(4, 36 + samples, true)
  text(8, 'WAVE')
  text(12, 'fmt ')
  data.setUint32(16, 16, true) // the size of this chunk
  data.setUint16(20, 1, true) // PCM
  data.setUint16(22, 1, true) // mono
  data.setUint32(24, rate, true)
  data.setUint32(28, rate, true) // bytes a second
  data.setUint16(32, 1, true) // bytes a sample
  data.setUint16(34, 8, true) // bits a sample
  text(36, 'data')
  data.setUint32(40, samples, true)
  // Unsigned 8-bit samples: 128 is silence.
  bytes.fill(128, 44)
  return bytes
}
