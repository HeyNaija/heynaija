'use client'

import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { CheckIcon, ShareIcon } from './icons'

const subscribeNever = () => () => {}

/**
 * For browsers that refuse the Clipboard API: the in-app browsers of social apps
 * often do, and so does any page on plain http. Keeps focus where it was.
 */
function copyTheOldWay(text: string) {
  const focused = document.activeElement
  const field = document.createElement('textarea')
  field.value = text
  field.readOnly = true
  field.style.position = 'fixed'
  field.style.opacity = '0'
  document.body.append(field)
  field.select()
  try {
    return document.execCommand('copy')
  } catch {
    return false
  } finally {
    field.remove()
    if (focused instanceof HTMLElement) focused.focus()
  }
}

/**
 * Share a post. Where the browser has a share sheet (phones, mostly, which is
 * where WhatsApp is) it opens that; elsewhere it copies the post's link and says
 * so, on screen and to screen readers. Needs no account.
 */
export function ShareButton({ id, handle, text }: { id: string; handle: string; text: string }) {
  // The server cannot know, so the first render says "Copy link" everywhere and
  // phones switch to "Share" once the page is running.
  const native = useSyncExternalStore(subscribeNever, () => typeof navigator.share === 'function', () => false)
  const [status, setStatus] = useState('')
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  useEffect(() => () => clearTimeout(timer.current), [])

  function say(message: string) {
    setStatus(message)
    clearTimeout(timer.current)
    timer.current = setTimeout(() => setStatus(''), 2500)
  }

  async function share() {
    const url = new URL(`/p/${id}`, window.location.origin).href
    if (typeof navigator.share === 'function') {
      try {
        await navigator.share({ url, title: `@${handle} on HeyNaija`, text })
        return
      } catch (err) {
        // Closing the share sheet is a choice, not a failure. Anything else
        // (a browser that refuses, say) falls through to copying.
        if (err instanceof DOMException && err.name === 'AbortError') return
      }
    }
    try {
      await navigator.clipboard.writeText(url)
      say('Link copied')
    } catch {
      say(copyTheOldWay(url) ? 'Link copied' : 'Could not copy the link')
    }
  }

  return (
    <span className="share">
      <button type="button" className="icon-btn" aria-label={native ? 'Share' : 'Copy link'} onClick={share}>
        {status === 'Link copied' ? <CheckIcon size={18} /> : <ShareIcon size={18} />}
      </button>
      <span role="status" className="share-status">
        {status}
      </span>
    </span>
  )
}
