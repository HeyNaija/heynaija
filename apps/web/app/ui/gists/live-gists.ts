'use client'

// The live Gists this member may join (GET /v1/gists/live, which never lists one they
// would be refused), shared by everything that shows them: the Gists button in the top
// bar, its panel, and Live now on Home. One request for all of them, every 30 seconds
// while the tab is visible and something on the page is showing the list.
import { useSyncExternalStore } from 'react'
import { LIVE_POLL_MS, type LiveGist } from '@/lib/gists'
import { gistCall } from './api'

const NONE: LiveGist[] = []
let items: LiveGist[] = NONE
let timer: ReturnType<typeof setTimeout> | undefined
let asking = false
const listeners = new Set<() => void>()

async function load() {
  clearTimeout(timer)
  if (asking) return
  asking = true
  const res = await gistCall<{ items: LiveGist[] }>('GET', '/live')
  asking = false
  if (listeners.size === 0) return
  // A failed ask keeps what is shown; the next one tries again.
  if (res.ok) {
    items = res.data.items
    listeners.forEach((tell) => tell())
  }
  if (!document.hidden) timer = setTimeout(load, LIVE_POLL_MS)
}

const onVisibility = () => (document.hidden ? clearTimeout(timer) : void load())

function subscribe(tell: () => void) {
  listeners.add(tell)
  if (listeners.size === 1) {
    document.addEventListener('visibilitychange', onVisibility)
    void load()
  }
  return () => {
    listeners.delete(tell)
    if (listeners.size > 0) return
    clearTimeout(timer)
    document.removeEventListener('visibilitychange', onVisibility)
  }
}

/** Asks again now, when fresh counts matter: the Gists panel opening. */
export const refreshLiveGists = () => void (listeners.size > 0 && load())

export function useLiveGists(): LiveGist[] {
  return useSyncExternalStore(subscribe, () => items, () => NONE)
}
