'use client'

import { useEffect, useId, useRef, useState } from 'react'
import type { PostVideo as PostVideoData } from '@/lib/api'
import { formatDuration, formatSize, videoFiles } from '@/lib/video'
import { PlayIcon } from './icons'

// Video must be served from the media bucket's own domain, not through our nginx
// (ADR 0019 section 3.3), once Cloudflare has confirmed it. Unset, files come from /media.
const ORIGIN = process.env.NEXT_PUBLIC_VIDEO_ORIGIN ?? ''
// Which rendition plays: 360 until the low-data setting (PR #49) picks one (240 saver, 480 full).
const QUALITY = 360
const PLAYING = 'heynaija:video-playing'

/**
 * A post's video: the poster first, a tap to play, never autoplay. Only one video
 * plays at a time, and one scrolled out of view pauses. The browser's own controls
 * give keyboard play, seek and focus.
 *
 * `held` is the low-data hold (ADR 0019 section 5.2): nothing, not even the poster, is
 * fetched until the reader taps. It is off here because the low-data setting is not
 * in this branch yet (PR #49); the placeholder is built and waits for it to be wired.
 */
export function PostVideo({ video, held = false }: { video: PostVideoData; held?: boolean }) {
  const id = useId()
  const [started, setStarted] = useState(false)
  const [loaded, setLoaded] = useState(!held)
  const player = useRef<HTMLVideoElement>(null)
  const files = videoFiles(video.src, video.renditions, QUALITY, ORIGIN)
  const length = formatDuration(video.durationMs)
  const label = video.description.trim() ? `${video.description.trim()}, ${length}` : `Video, ${length}`
  // Reserve the box from the stored size so the page does not jump; very tall clips are cropped to a limit.
  const ratio = Math.min(Math.max(video.width / video.height, 9 / 16), 2)

  // Starting one pauses the others.
  useEffect(() => {
    const stop = (e: Event) => {
      if ((e as CustomEvent<string>).detail !== id) setStarted(false)
    }
    window.addEventListener(PLAYING, stop)
    return () => window.removeEventListener(PLAYING, stop)
  }, [id])

  // Scrolled fully out of view: pause (by putting the poster back).
  useEffect(() => {
    const el = player.current
    if (!started || !el) return
    const watch = new IntersectionObserver(([entry]) => {
      if (entry && !entry.isIntersecting) el.pause()
    })
    watch.observe(el)
    return () => watch.disconnect()
  }, [started])

  if (!files.file) return null

  const play = () => {
    window.dispatchEvent(new CustomEvent(PLAYING, { detail: id }))
    setLoaded(true)
    setStarted(true)
  }

  return (
    <div className="post-video" style={{ aspectRatio: ratio }}>
      {started ? (
        <video
          ref={player}
          src={files.file}
          poster={files.poster}
          controls
          autoPlay
          playsInline
          preload="auto"
          aria-label={label}
          onEnded={() => setStarted(false)}
        />
      ) : (
        <button type="button" className="post-video-start" onClick={play} aria-label={`Play video, ${length}${video.description.trim() ? `: ${video.description.trim()}` : ''}`}>
          {loaded ? (
            // eslint-disable-next-line @next/next/no-img-element -- a poster served as is, at the size we made it
            <img src={files.poster} alt="" width={video.width} height={video.height} loading="lazy" />
          ) : null}
          <span className="post-video-badge">
            <PlayIcon size={18} filled />
            <span>{loaded ? length : `Tap to load video, ${length}, about ${formatSize(files.bytes)}`}</span>
          </span>
        </button>
      )}
    </div>
  )
}
