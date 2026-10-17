'use client'

import { useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Avatar } from './avatar'
import { CheckIcon, CloseIcon, FacebookIcon, LinkIcon, ShareIcon, TelegramIcon, WhatsAppIcon, XBrandIcon } from './icons'

/** Some in-app browsers refuse the Clipboard API. Keep focus inside the popup. */
function copyTheOldWay(text: string, container: HTMLElement) {
  const focused = document.activeElement
  const field = document.createElement('textarea')
  field.value = text
  field.readOnly = true
  field.style.position = 'fixed'
  field.style.top = '0'
  field.style.left = '0'
  field.style.opacity = '0'
  container.append(field)
  field.focus({ preventScroll: true })
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

type SharePost = { id: string; handle: string; text: string; name?: string | null; avatar?: string | null }

/** Every browser gets the same in-app sharing choices, including signed-out visitors. */
export function ShareButton({ id, ...post }: SharePost) {
  const [url, setUrl] = useState<string | null>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const dialogId = useId()

  return (
    <>
      <button
        ref={trigger}
        type="button"
        className="icon-btn"
        aria-label="Share post"
        aria-haspopup="dialog"
        aria-expanded={url !== null}
        aria-controls={url ? dialogId : undefined}
        onClick={() => setUrl(new URL(`/p/${id}`, window.location.origin).href)}
      >
        <ShareIcon size={18} />
      </button>
      {url ? createPortal(
        <ShareDialog
          {...post}
          id={dialogId}
          url={url}
          onClose={() => {
            setUrl(null)
            trigger.current?.focus({ preventScroll: true })
          }}
        />,
        document.body,
      ) : null}
    </>
  )
}

function ShareDialog({ id, url, handle, text, name, avatar, onClose }: Omit<SharePost, 'id'> & {
  id: string
  url: string
  onClose: () => void
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const link = useRef<HTMLInputElement>(null)
  const backdropPress = useRef(false)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const [status, setStatus] = useState('')
  const [copying, setCopying] = useState(false)
  const shareText = text ? `${text}\n\n@${handle} on HeyNaija` : `A post by @${handle} on HeyNaija`
  const destinations = [
    { name: 'WhatsApp', icon: WhatsAppIcon, href: `https://wa.me/?${new URLSearchParams({ text: `${shareText}\n${url}` })}` },
    { name: 'X', icon: XBrandIcon, href: `https://twitter.com/intent/tweet?${new URLSearchParams({ text: shareText, url })}` },
    { name: 'Telegram', icon: TelegramIcon, href: `https://t.me/share/url?${new URLSearchParams({ url, text: shareText })}` },
    { name: 'Facebook', icon: FacebookIcon, href: `https://www.facebook.com/sharer/sharer.php?${new URLSearchParams({ u: url })}` },
  ]

  // A modal dialog contains keyboard focus and makes the feed behind it inert.
  // Unmounting closes it; calling close() in cleanup would race Strict Mode.
  useEffect(() => {
    if (!dialog.current?.open) dialog.current?.showModal()
    return () => clearTimeout(timer.current)
  }, [])

  async function copyLink() {
    if (copying) return
    setCopying(true)
    clearTimeout(timer.current)
    let copied = false
    try {
      await navigator.clipboard.writeText(url)
      copied = true
    } catch {
      // The fallback must be inside the modal: the rest of the document is inert.
      if (dialog.current?.open) copied = copyTheOldWay(url, dialog.current)
    }
    if (!dialog.current?.open) return
    setCopying(false)
    setStatus(copied ? 'Link copied' : 'Could not copy. Select and copy the post link.')
    if (copied) {
      timer.current = setTimeout(() => setStatus(''), 3000)
    } else {
      link.current?.focus()
      link.current?.select()
    }
  }

  return (
    <dialog
      ref={dialog}
      id={id}
      className="share-dialog"
      aria-labelledby={`${id}-title`}
      aria-describedby={`${id}-description`}
      onClose={onClose}
      onKeyDown={(event) => {
        if (event.key !== 'Tab') return
        const controls = event.currentTarget.querySelectorAll<HTMLElement>('a[href], button:not(:disabled), input')
        const first = controls[0]
        const last = controls[controls.length - 1]
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault()
          last?.focus()
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault()
          first?.focus()
        }
      }}
      onPointerDown={(event) => { backdropPress.current = event.target === event.currentTarget }}
      onClick={(event) => {
        if (backdropPress.current && event.target === event.currentTarget) dialog.current?.close()
      }}
    >
      <div className="share-dialog-content">
        <div className="share-dialog-header">
          <div>
            <h2 id={`${id}-title`}>Share post</h2>
            <p id={`${id}-description`}>Keep the conversation going.</p>
          </div>
          <button type="button" className="icon-btn share-close" aria-label="Close share popup" autoFocus onClick={() => dialog.current?.close()}>
            <CloseIcon size={20} />
          </button>
        </div>

        <div className="share-preview">
          <div className="share-preview-author">
            <Avatar handle={handle} src={avatar} size={36} />
            <div>
              <p className="share-preview-name">{name || `@${handle}`}</p>
              <p className="share-preview-handle">{name ? `@${handle} · HeyNaija` : 'HeyNaija'}</p>
            </div>
          </div>
          <p className="share-preview-text">{text || 'View this post on HeyNaija.'}</p>
        </div>

        <div className="share-destinations" aria-label="Share to another app">
          {destinations.map(({ name: destination, icon: Icon, href }) => (
            <a key={destination} href={href} className="share-destination" target="_blank" rel="noopener noreferrer" aria-label={`Share on ${destination} (opens in a new tab)`}>
              <span className="share-destination-icon"><Icon size={23} /></span>
              <span>{destination}</span>
            </a>
          ))}
        </div>

        <div className="share-copy-section">
          <label htmlFor={`${id}-link`}>Or copy the link</label>
          <div className="share-copy-field">
            <LinkIcon size={18} />
            <input ref={link} id={`${id}-link`} aria-label="Post link" type="text" value={url} readOnly onFocus={(event) => event.currentTarget.select()} />
            <button type="button" className="btn btn-primary" disabled={copying} onClick={copyLink}>
              {status === 'Link copied' ? <><CheckIcon size={16} />Copied</> : 'Copy link'}
            </button>
          </div>
          <p role="status" className={`share-copy-status${status && status !== 'Link copied' ? ' is-error' : ''}`}>{status}</p>
        </div>
      </div>
    </dialog>
  )
}
