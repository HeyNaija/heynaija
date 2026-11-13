'use client'

import { type CSSProperties, type KeyboardEvent, type ReactNode, type RefObject, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { formatDuration } from '@/lib/video'
import { ExitFullScreenIcon, FullScreenIcon, MutedIcon, PauseIcon, PlayIcon, SoundIcon } from './icons'

/** What the controls show, read from the element at each of its events. */
type Media = { paused: boolean; ended: boolean; time: number; length: number; loaded: number; muted: boolean; waiting: boolean; failed: boolean }

const STILL: Media = { paused: true, ended: false, time: 0, length: 0, loaded: 0, muted: false, waiting: false, failed: false }

// Every event that changes one of those. hls.js (`useHls`) plays through the same element,
// so they fire for it as they do for the browser's own HLS.
const EVENTS = ['loadedmetadata', 'durationchange', 'timeupdate', 'progress', 'play', 'pause', 'playing', 'waiting', 'seeking', 'seeked', 'canplay', 'ended', 'volumechange', 'error', 'emptied'] as const

function read(video: HTMLVideoElement): Media {
  const time = video.currentTime
  // What has loaded from here on: the end of the stretch the playhead is in.
  let loaded = time
  for (let i = 0; i < video.buffered.length; i++) {
    if (video.buffered.start(i) <= time + 0.1 && video.buffered.end(i) >= time) loaded = video.buffered.end(i)
  }
  return {
    paused: video.paused,
    ended: video.ended,
    time,
    length: Number.isFinite(video.duration) ? video.duration : 0,
    loaded,
    muted: video.muted,
    // Playing, but waiting for more of it to arrive.
    waiting: !video.paused && !video.ended && video.readyState < HTMLMediaElement.HAVE_FUTURE_DATA,
    failed: video.error !== null,
  }
}

const same = (a: Media, b: Media) => (Object.keys(a) as (keyof Media)[]).every((key) => a[key] === b[key])

function useMedia(player: RefObject<HTMLVideoElement | null>): Media {
  const [media, setMedia] = useState(STILL)
  useEffect(() => {
    const video = player.current
    if (!video) return
    const update = () => setMedia((was) => {
      const now = read(video)
      return same(was, now) ? was : now
    })
    update()
    for (const name of EVENTS) video.addEventListener(name, update)
    return () => {
      for (const name of EVENTS) video.removeEventListener(name, update)
    }
  }, [player])
  return media
}

/**
 * How this browser goes full screen: the player itself (controls and all), or, on iPhone
 * Safari, which allows only a video, the video alone in Apple's own player.
 */
type FullScreen = 'player' | 'video' | null
type WebkitVideo = HTMLVideoElement & { webkitEnterFullscreen: () => void }
const fullScreenWay = (): FullScreen =>
  document.fullscreenEnabled ? 'player' : 'webkitEnterFullscreen' in HTMLVideoElement.prototype ? 'video' : null
const unchanging = () => () => {}

/** m:ss, rounded down, as a clock counts. */
const clock = (seconds: number) => formatDuration(Math.floor(seconds) * 1000)

// How long the controls stay after the last tap, pointer move or key while it plays.
const AWAKE_MS = 2500

/**
 * HeyNaija's own controls over a <video>: play and pause (a big button in the middle and
 * one in the bar), a seek bar that shows what has loaded, the time, mute and full screen.
 * While it plays they fade, and come back on a tap, a pointer move or a key; they stay
 * while the keyboard is in them. Space or K plays and pauses, the arrows seek 5 seconds,
 * M mutes and F goes full screen.
 *
 * The caller renders the <video> as `children`, with `player` as its ref, and gives it its
 * source: a file, a playlist, or hls.js (`useHls`). The controls only ever talk to that
 * element. `length` (seconds) is shown until the file says how long it is; `failed` is a
 * failure the element cannot report itself, such as hls.js giving up; `autoFocus` moves
 * focus to the play button, for a player that replaced what had it.
 */
export function VideoPlayer({
  player,
  length: known = 0,
  failed: failedOutside = false,
  autoFocus = false,
  children,
}: {
  player: RefObject<HTMLVideoElement | null>
  length?: number
  failed?: boolean
  autoFocus?: boolean
  children: ReactNode
}) {
  const frame = useRef<HTMLDivElement>(null)
  const surface = useRef<HTMLDivElement>(null)
  const toggle = useRef<HTMLButtonElement>(null)
  const seekBar = useRef<HTMLInputElement>(null)
  const media = useMedia(player)
  const way = useSyncExternalStore(unchanging, fullScreenWay, () => null)
  const [full, setFull] = useState(false)
  const [awake, setAwake] = useState(true)
  const [keyboard, setKeyboard] = useState(false)
  const [onBar, setOnBar] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [said, setSaid] = useState('')
  const sleep = useRef<number | undefined>(undefined)
  const hush = useRef<number | undefined>(undefined)
  const touched = useRef(false)

  const length = media.length || known
  const lengthText = formatDuration(length * 1000)
  const now = media.ended ? lengthText : clock(media.time)
  const failed = media.failed || failedOutside
  const shown = media.paused || failed || awake || keyboard || onBar || dragging

  const wake = () => {
    setAwake(true)
    window.clearTimeout(sleep.current)
    sleep.current = window.setTimeout(() => setAwake(false), AWAKE_MS)
  }
  const rest = () => {
    window.clearTimeout(sleep.current)
    setAwake(false)
  }
  /** Says what a key did, where nothing else would. Emptied again, so the same words twice are heard twice. */
  const tell = (words: string) => {
    setSaid(words)
    window.clearTimeout(hush.current)
    hush.current = window.setTimeout(() => setSaid(''), 3000)
  }

  // Each time it starts, the controls stay a moment and then fade.
  useEffect(() => {
    if (!media.paused) wake()
  }, [media.paused])
  useEffect(() => () => {
    window.clearTimeout(sleep.current)
    window.clearTimeout(hush.current)
  }, [])
  useEffect(() => {
    const change = () => setFull(document.fullscreenElement === frame.current)
    document.addEventListener('fullscreenchange', change)
    return () => document.removeEventListener('fullscreenchange', change)
  }, [])
  useEffect(() => {
    if (autoFocus) toggle.current?.focus({ preventScroll: true })
  }, [autoFocus])

  const playPause = () => {
    const video = player.current
    if (!video) return
    if (video.paused || video.ended) void video.play().catch(() => {})
    else video.pause()
  }
  const seek = (to: number) => {
    const video = player.current
    if (!video || !Number.isFinite(video.duration)) return
    video.currentTime = Math.min(Math.max(to, 0), video.duration)
  }
  const mute = () => {
    const video = player.current
    if (video) video.muted = !video.muted
  }
  const fullScreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {})
    else if (way === 'player') void frame.current?.requestFullscreen({ navigationUI: 'hide' }).catch(() => {})
    else if (way === 'video') (player.current as WebkitVideo | null)?.webkitEnterFullscreen()
  }
  const drag = () => {
    setDragging(true)
    const done = () => {
      setDragging(false)
      wake()
      window.removeEventListener('pointerup', done)
      window.removeEventListener('pointercancel', done)
    }
    window.addEventListener('pointerup', done)
    window.addEventListener('pointercancel', done)
  }

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    setKeyboard(true)
    wake()
    const video = player.current
    if (!video || e.altKey || e.ctrlKey || e.metaKey) return
    const key = e.key.length === 1 ? e.key.toLowerCase() : e.key
    const onSeekBar = e.target === seekBar.current
    // On a button, Space presses that button; off the seek bar, up and down scroll the page.
    if (key === 'k' || (key === ' ' && !(e.target instanceof HTMLButtonElement))) {
      tell(video.paused || video.ended ? 'Playing' : 'Paused')
      playPause()
    } else if (key === 'ArrowLeft' || key === 'ArrowRight' || (onSeekBar && (key === 'ArrowUp' || key === 'ArrowDown'))) {
      if (Number.isFinite(video.duration)) {
        const to = Math.min(Math.max(video.currentTime + (key === 'ArrowLeft' || key === 'ArrowDown' ? -5 : 5), 0), video.duration)
        seek(to)
        // The seek bar says its own new value.
        if (!onSeekBar) tell(`${clock(to)} of ${lengthText}`)
      }
    } else if (key === 'm') {
      tell(video.muted ? 'Sound on' : 'Muted')
      mute()
    } else if (key === 'f' && way) {
      fullScreen()
    } else return
    e.preventDefault()
  }

  const played = length ? Math.min(media.time / length, 1) : 0
  const loaded = length ? Math.min(Math.max(media.loaded, media.time) / length, 1) : 0
  const classes = ['video-player', media.paused ? '' : 'is-playing', shown ? '' : 'is-resting'].filter(Boolean).join(' ')

  return (
    // Its keys work from any of its controls, each of them a button or the slider.
    <div
      ref={frame}
      className={classes}
      onKeyDown={onKeyDown}
      onFocus={(e) => {
        if (e.target.matches(':focus-visible')) setKeyboard(true)
      }}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) setKeyboard(false)
      }}
      onPointerDown={(e) => {
        touched.current = e.pointerType === 'touch'
        if (e.target !== surface.current) wake()
      }}
      onPointerMove={(e) => {
        if (e.pointerType === 'mouse') wake()
      }}
      onPointerLeave={(e) => {
        if (e.pointerType === 'mouse' && !media.paused) rest()
      }}
    >
      {children}
      {/* The picture: a click plays or pauses; a tap shows the controls, or hides them while it plays. */}
      <div
        ref={surface}
        className="video-player-surface"
        onClick={() => {
          if (!touched.current) {
            playPause()
            wake()
          } else if (shown && !media.paused) rest()
          else wake()
        }}
      />
      <div className="video-player-middle">
        {media.waiting ? (
          <span className="video-player-wait" aria-hidden="true" />
        ) : (
          // The bar's button is the one for keyboards and screen readers; this is a bigger target for a thumb.
          <button type="button" className="video-player-big" tabIndex={-1} aria-hidden="true" onClick={playPause}>
            {media.paused ? <PlayIcon size={28} filled /> : <PauseIcon size={28} filled />}
          </button>
        )}
      </div>
      <div
        className="video-player-bar"
        onPointerEnter={(e) => setOnBar(e.pointerType === 'mouse')}
        onPointerLeave={() => setOnBar(false)}
      >
        <button ref={toggle} type="button" className="video-player-btn is-play" aria-label={media.paused ? 'Play' : 'Pause'} onClick={playPause}>
          {media.paused ? <PlayIcon size={20} filled /> : <PauseIcon size={20} filled />}
        </button>
        {/* The seek bar says the same to a screen reader. */}
        <span className="video-player-time" aria-hidden="true">
          {now} / {lengthText}
        </span>
        <input
          ref={seekBar}
          type="range"
          className="video-player-seek"
          aria-label="Seek"
          aria-valuetext={`${now} of ${lengthText}`}
          min={0}
          max={media.length || 1}
          step="any"
          value={media.length ? Math.min(media.time, media.length) : 0}
          disabled={!media.length}
          onChange={(e) => seek(Number(e.currentTarget.value))}
          onPointerDown={drag}
          style={{ '--played': played, '--loaded': loaded } as CSSProperties}
        />
        <button type="button" className="video-player-btn is-mute" aria-label={media.muted ? 'Unmute' : 'Mute'} onClick={mute}>
          {media.muted ? <MutedIcon size={20} /> : <SoundIcon size={20} />}
        </button>
        {way ? (
          <button type="button" className="video-player-btn is-full" aria-label={full ? 'Exit full screen' : 'Full screen'} onClick={fullScreen}>
            {full ? <ExitFullScreenIcon size={20} /> : <FullScreenIcon size={20} />}
          </button>
        ) : null}
      </div>
      {failed ? <p className="video-player-error" role="alert">This video could not be played.</p> : null}
      <p className="sr-only" role="status">
        {said}
      </p>
    </div>
  )
}
