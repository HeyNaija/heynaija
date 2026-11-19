'use client'

import { useState } from 'react'
import { giphyMediaUrl, giphyStillUrl } from '@/lib/giphy'

/**
 * A GIF from Giphy, shown from Giphy's own address built from its id (never copied to our
 * storage). The box has a fixed shape so the page does not jump while it loads; readers who ask
 * for less motion get its first frame. `held` is the low-data hold, as for pictures: nothing is
 * fetched until the reader taps.
 */
export function PostGiphy({ giphy, held = false }: { giphy: { id: string; alt: string }; held?: boolean }) {
  const [loaded, setLoaded] = useState(!held)
  const url = giphyMediaUrl(giphy.id)
  const still = giphyStillUrl(giphy.id)
  if (!url || !still) return null
  const alt = giphy.alt.trim()
  return (
    <figure className="post-giphy">
      {loaded ? (
        <picture>
          <source media="(prefers-reduced-motion: reduce)" srcSet={still} />
          {/* eslint-disable-next-line @next/next/no-img-element -- Giphy's own file; Giphy asks that it is loaded from them directly */}
          <img src={url} alt={alt} loading="lazy" decoding="async" referrerPolicy="no-referrer" />
        </picture>
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
