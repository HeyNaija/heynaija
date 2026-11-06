'use client'

import { useEffect, useId, useRef, useState } from 'react'
import type { PostVideo as PostVideoData } from '@/lib/api'
import { formatDuration, formatSize, videoFiles } from '@/lib/video'
import { PlayIcon } from './icons'

const PLAYING = 'heynaija:video-playing'

/**
 * A post's video: the poster first, a tap to play, never autoplay. Only one video
 * plays at a time, and one scrolled out of view pauses. The browser's own controls
 * give keyboard play, seek and focus.
 *
 * It plays HLS from the media domain (ADR 0021 section 7) where the browser plays HLS
 * itself (Safari, every browser on iPhones); hls.js for the rest comes with the player's
 * own pull request (PR 4), as does the `full` data setting.
 *
 * `held` is the low-data hold (ADR 0019 section 5.2): nothing, not even the poster, is
 * fetched until the reader taps. PostItem sets it from the reader's low-data choice
 * (`currentDataSaver()`), as it does for pictures.
 */
export function PostVideo({ video, held = false }: { video: PostVideoData; held?: boolean }) {
  const id = useId()
  const [started, setStarted] = useState(false)
  const [loaded, setLoaded] = useState(!held)
  const player = useRef<HTMLVideoElement>(null)
  const files = videoFiles(video, held ? 'saver' : 'auto')
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

  if (!files.playlist) return null

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
          src={files.playlist}
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
