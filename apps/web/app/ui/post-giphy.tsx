'use client'

import { useState } from 'react'
import { giphySource, giphyStillUrl } from '@/lib/giphy'
import { GifToggle, useGif } from './use-gif'

/**
 * A GIF from Giphy, shown from Giphy's own address built from its id (never copied to our
 * storage). The box has a fixed shape so the page does not jump while it loads. Like an uploaded
 * GIF it has Pause and Play; a device that asks for less motion starts on the first frame. `held`
 * is the low-data hold, as for pictures: nothing is fetched until the reader taps, and then it
 * plays as it would for anyone else.
 */
export function PostGiphy({ giphy, held = false }: { giphy: { id: string; alt: string }; held?: boolean }) {
  const [loaded, setLoaded] = useState(!held)
  const { playing, chosen, toggle } = useGif()
  const src = giphySource(giphy.id, playing)
  const still = giphyStillUrl(giphy.id)
  if (!src || !still) return null
  const alt = giphy.alt.trim()
  return (
    <figure className="post-giphy">
      {loaded ? (
        <div className="post-giphy-frame">
          <picture>
            {/* Before the page is alive the server cannot know the setting: the browser picks the first frame itself. */}
            {chosen ? null : <source media="(prefers-reduced-motion: reduce)" srcSet={still} />}
            {/* eslint-disable-next-line @next/next/no-img-element -- Giphy's own file; Giphy asks that it is loaded from them directly */}
            <img src={src} alt={alt} loading="lazy" decoding="async" referrerPolicy="no-referrer" />
          </picture>
          <GifToggle playing={playing} onToggle={toggle} />
          <span role="status" className="sr-only">{chosen ? (playing ? 'GIF playing' : 'GIF paused') : ''}</span>
        </div>
      ) : (
        <button type="button" className="post-giphy-held media-held" aria-label={`Tap to load GIF${alt ? `: ${alt}` : ''}`} onClick={() => setLoaded(true)}>
          <span className="media-held-label">Tap to load GIF</span>
          {alt ? <span className="media-held-alt">{alt}</span> : null}
        </button>
      )}
      <figcaption className="post-giphy-credit">GIF via GIPHY</figcaption>
    </figure>
  )
}
