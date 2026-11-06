'use client'

import type Hls from 'hls.js'
import { type RefObject, useEffect, useRef, useState, useSyncExternalStore } from 'react'

const unchanging = () => () => {}
let native: boolean | undefined
/** Whether this browser plays HLS itself: Safari, every browser on iPhones, recent Chrome. */
const playsHls = () => (native ??= document.createElement('video').canPlayType('application/vnd.apple.mpegurl') !== '')

/**
 * Plays an HLS playlist in `player` (ADR 0021 section 7): as the element's `src` where the
 * browser plays HLS itself, and through hls.js where it cannot (Firefox above all). hls.js
 * is fetched then and only then, so no page pays for it before a video is played. Its
 * light build: post videos have no subtitles, separate sound tracks or DRM.
 *
 * `playlist` is set while the video is shown, null otherwise. Call `start` when the member
 * plays it from the poster; hls.js plays it once attached, as `autoPlay` does for the
 * browser's own player, so `autoPlay` goes only with `src`.
 *
 * Next keeps a page the member leaves mounted but hidden (`useOneVideo`), and hls.js is let
 * go with it. When the page comes back, the video is attached again where it was, paused.
 *
 * `failed` is hls.js giving up (a playlist or piece that would not load, a picture it could
 * not play, or hls.js itself not loading), which the player shows as the browser's own error.
 */
export function useHls(player: RefObject<HTMLVideoElement | null>, playlist: string | null) {
  const native = useSyncExternalStore(unchanging, playsHls, () => true)
  const [failed, setFailed] = useState(false)
  // Played from the poster, and not yet attached.
  const wanted = useRef(false)
  // Where it was when its page was hidden; -1 is the start.
  const left = useRef(-1)

  useEffect(() => {
    const el = player.current
    if (native || !playlist || !el || failed) return
    let hls: Hls | undefined
    let gone = false
    import('hls.js/light')
      .then(({ default: Hls }) => {
        if (gone) return
        if (!Hls.isSupported()) return setFailed(true)
        hls = new Hls({ startPosition: left.current })
        // It has tried again already; failing sets `failed`, and this effect lets it go.
        hls.on(Hls.Events.ERROR, (_, data) => {
          if (data.fatal) setFailed(true)
        })
        hls.on(Hls.Events.MANIFEST_PARSED, () => {
          if (wanted.current) void el.play().catch(() => {})
          wanted.current = false
        })
        hls.loadSource(playlist)
        hls.attachMedia(el)
      })
      .catch(() => {
        if (!gone) setFailed(true)
      })
    return () => {
      gone = true
      // A hidden page's video has no box. (Strict Mode's rehearsal also lands here, on one that can be seen.)
      if (el.getClientRects().length === 0) {
        wanted.current = false
        left.current = el.currentTime
      }
      hls?.destroy()
    }
  }, [player, native, playlist, failed])

  return {
    src: native ? (playlist ?? undefined) : undefined,
    failed,
    start: () => {
      wanted.current = true
      left.current = -1
      setFailed(false)
    },
  }
}
