'use client'

import { useEffect, useRef, useState } from 'react'
import type { PostVideo as PostVideoData } from '@/lib/api'
import { formatDuration, formatSize, videoFiles } from '@/lib/video'
import { PlayIcon } from './icons'
import { useOneVideo } from './use-one-video'
import { VideoPlayer } from './video-player'

// Video must be served from the media bucket's own domain, not through our nginx
// (ADR 0019 section 3.3), once Cloudflare has confirmed it. Unset, files come from /media.
const ORIGIN = process.env.NEXT_PUBLIC_VIDEO_ORIGIN ?? ''
// Which rendition plays: 360 until the low-data setting picks one (240 saver, 480 full); not wired yet.
const QUALITY = 360

/**
 * A post's video: the poster first, a tap to play, never autoplay. Only one video
 * plays at a time, and one scrolled out of view or on a page left behind pauses
 * (`useOneVideo`). It plays under our own controls (`VideoPlayer`), and when it ends the
 * poster comes back.
 *
 * `held` is the low-data hold (ADR 0019 section 5.2): nothing, not even the poster, is
 * fetched until the reader taps. PostItem sets it from the reader's low-data choice
 * (`currentDataSaver()`), as it does for pictures.
 */
export function PostVideo({ video, held = false }: { video: PostVideoData; held?: boolean }) {
  const [started, setStarted] = useState(false)
  const [loaded, setLoaded] = useState(!held)
  const player = useRef<HTMLVideoElement>(null)
  // The poster's button gets focus back when a video that had it ends.
  const refocus = useRef(false)
  const files = videoFiles(video.src, video.renditions, QUALITY, ORIGIN)
  const length = formatDuration(video.durationMs)
  const label = video.description.trim() ? `${video.description.trim()}, ${length}` : `Video, ${length}`
  // Reserve the box from the stored size so the page does not jump; very tall clips are cropped to a limit.
  const ratio = Math.min(Math.max(video.width / video.height, 9 / 16), 2)

  // Starting another puts the poster back.
  const playing = useOneVideo(player, started, () => setStarted(false))

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
    playing()
    setLoaded(true)
    setStarted(true)
  }

  return (
    <div className="post-video" style={{ aspectRatio: ratio }}>
      {started ? (
        // It replaces the poster's button, so focus moves to its own play button.
        <VideoPlayer player={player} length={video.durationMs / 1000} autoFocus>
          <video
            ref={player}
            src={files.file}
            poster={files.poster}
            autoPlay
            playsInline
            preload="auto"
            aria-label={label}
            // Also when it is played again from its controls, on coming back to its page.
            onPlay={playing}
            onEnded={(e) => {
              refocus.current = e.currentTarget.parentElement?.contains(document.activeElement) ?? false
              setStarted(false)
            }}
          />
        </VideoPlayer>
      ) : (
        <button
          ref={(el) => {
            if (el && refocus.current) el.focus({ preventScroll: true })
            refocus.current = false
          }}
          type="button"
          className="post-video-start"
          onClick={play}
          aria-label={`Play video, ${length}${video.description.trim() ? `: ${video.description.trim()}` : ''}`}
        >
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
