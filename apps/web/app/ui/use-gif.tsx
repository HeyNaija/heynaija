'use client'

import { useState, useSyncExternalStore } from 'react'
import { gifPlaying } from '@/lib/gif-motion'
import { PauseIcon, PlayIcon } from './icons'

const REDUCED_MOTION = '(prefers-reduced-motion: reduce)'
const watchMotion = (notify: () => void) => {
  const query = window.matchMedia(REDUCED_MOTION)
  query.addEventListener('change', notify)
  return () => query.removeEventListener('change', notify)
}
/** Whether the reader's device asks for less motion. False while rendering on the server. */
export const useReducedMotion = () =>
  useSyncExternalStore(watchMotion, () => window.matchMedia(REDUCED_MOTION).matches, () => false)

/**
 * Pause and play for a GIF. It plays on its own unless the reader's device asks
 * for less motion; either way the reader can change it, and anything that moves
 * for more than a few seconds must be pausable. `chosen` is whether they have.
 */
export function useGif(): { playing: boolean; chosen: boolean; toggle: () => void } {
  const reduced = useReducedMotion()
  const [choice, setChoice] = useState<boolean | null>(null)
  const playing = gifPlaying(choice, reduced)
  return { playing, chosen: choice !== null, toggle: () => setChoice(!playing) }
}

export function GifToggle({ playing, onToggle, className = '' }: { playing: boolean; onToggle: () => void; className?: string }) {
  return (
    <button type="button" className={`gif-toggle ${className}`} aria-label={playing ? 'Pause GIF' : 'Play GIF'} onClick={onToggle}>
      {playing ? <PauseIcon size={14} filled /> : <PlayIcon size={14} filled />}
      <span aria-hidden="true">GIF</span>
    </button>
  )
}
