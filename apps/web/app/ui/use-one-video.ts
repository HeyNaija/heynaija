'use client'

import { type RefObject, useEffect, useEffectEvent, useId, useLayoutEffect } from 'react'

const PLAYING = 'heynaija:video-playing'

/**
 * What every video on the site does: only one plays at a time, and none plays on a
 * page the member has left.
 *
 * Next keeps the pages a member leaves mounted but hidden, so Back is instant
 * (`cacheComponents` hides them in React's <Activity>). A hidden <video> plays on, and
 * a hidden page's effects are cleaned up, its listener for other videos among them. So
 * the video is paused in a layout effect's cleanup, which runs as its page is hidden.
 *
 * `player` holds the video while `shown` is true. `onOther` runs when another video
 * starts; without it this one pauses. Call the returned function when this one starts.
 */
export function useOneVideo(player: RefObject<HTMLVideoElement | null>, shown: boolean, onOther?: () => void): () => void {
  const id = useId()
  const other = useEffectEvent(() => (onOther ? onOther() : player.current?.pause()))

  useEffect(() => {
    const stop = (e: Event) => {
      if ((e as CustomEvent<string>).detail !== id) other()
    }
    window.addEventListener(PLAYING, stop)
    return () => window.removeEventListener(PLAYING, stop)
  }, [id])

  useLayoutEffect(() => {
    const el = player.current
    if (!shown || !el) return
    return () => el.pause()
  }, [player, shown])

  return () => window.dispatchEvent(new CustomEvent(PLAYING, { detail: id }))
}
