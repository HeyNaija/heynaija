'use client'

import { useState } from 'react'
import { gifMedia, gifSource } from '@/lib/gif/providers'
import type { GifTag } from '@/lib/gif/types'
import { GifToggle, useGif } from './use-gif'

/**
 * A post's GIF, shown from its provider's own address built from the id (never copied to our
 * storage). The box has a fixed shape so the page does not jump while it loads. Like an uploaded
 * GIF it has Pause and Play; a device that asks for less motion starts on the first frame. `held`
 * is the low-data hold, as for pictures: nothing is fetched until the reader taps, and then it
 * plays as it would for anyone else. A provider this app does not know (or an id that does not
 * fit it) is a "GIF unavailable" box: no address is made up from what the post says.
 */
export function PostGif({ gif, held = false }: { gif: GifTag; held?: boolean }) {
  const [loaded, setLoaded] = useState(!held)
  const { playing, chosen, toggle } = useGif()
  const media = gifMedia(gif)
  const alt = gif.alt.trim()
  if (!media) {
    return (
      <figure className="post-gif">
        <div className="post-gif-unavailable" role="img" aria-label={`GIF unavailable${alt ? `: ${alt}` : ''}`}>
          <span aria-hidden="true">GIF unavailable</span>
          {alt ? <span className="media-held-alt" aria-hidden="true">{alt}</span> : null}
        </div>
      </figure>
    )
  }
  const src = gifSource(media, playing)
  return (
    <figure className="post-gif">
      {loaded ? (
        <div className="post-gif-frame">
          <picture>
            {/* Before the page is alive the server cannot know the setting: the browser picks the first frame itself. */}
            {chosen ? null : <source media="(prefers-reduced-motion: reduce)" srcSet={media.stillUrl} />}
            {/* eslint-disable-next-line @next/next/no-img-element -- the provider's own file; GIPHY asks that it is loaded from them directly */}
            <img src={src} alt={alt} loading="lazy" decoding="async" referrerPolicy="no-referrer" />
          </picture>
          <GifToggle playing={playing} onToggle={toggle} />
          <span role="status" className="sr-only">{chosen ? (playing ? 'GIF playing' : 'GIF paused') : ''}</span>
        </div>
      ) : (
        <button type="button" className="post-gif-held media-held" aria-label={`Tap to load GIF${alt ? `: ${alt}` : ''}`} onClick={() => setLoaded(true)}>
          <span className="media-held-label">Tap to load GIF</span>
          {alt ? <span className="media-held-alt">{alt}</span> : null}
        </button>
      )}
      <figcaption className="post-gif-credit">{media.provider.credit}</figcaption>
    </figure>
  )
}
