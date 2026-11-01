'use client'

import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import type { PostImage } from '@/lib/api'
import { CloseIcon, NextIcon, PauseIcon, PlayIcon, PreviousIcon } from './icons'

const REDUCED_MOTION = '(prefers-reduced-motion: reduce)'
const watchMotion = (notify: () => void) => {
  const query = window.matchMedia(REDUCED_MOTION)
  query.addEventListener('change', notify)
  return () => query.removeEventListener('change', notify)
}
/** Whether the reader's device asks for less motion. False while rendering on the server. */
const useReducedMotion = () =>
  useSyncExternalStore(watchMotion, () => window.matchMedia(REDUCED_MOTION).matches, () => false)

/**
 * Pause and play for a GIF. It plays on its own unless the reader's device asks
 * for less motion; either way the reader can change it, and anything that moves
 * for more than a few seconds must be pausable.
 */
function useGif(): [playing: boolean, toggle: () => void] {
  const reduced = useReducedMotion()
  const [chosen, setChosen] = useState<boolean | null>(null)
  const playing = chosen ?? !reduced
  return [playing, () => setChosen(!playing)]
}

function GifToggle({ playing, onToggle, className = '' }: { playing: boolean; onToggle: () => void; className?: string }) {
  return (
    <button type="button" className={`gif-toggle ${className}`} aria-label={playing ? 'Pause GIF' : 'Play GIF'} onClick={onToggle}>
      {playing ? <PauseIcon size={14} filled /> : <PlayIcon size={14} filled />}
      <span aria-hidden="true">GIF</span>
    </button>
  )
}

/**
 * A post's images. One image keeps its own shape (within limits); two to four
 * share a 16:9 frame. Tapping one opens it full screen in a viewer; without
 * JavaScript, or with a modifier key held, the link opens the large image itself.
 */
export function PostImages({ images, compact = false, saver = false }: { images: PostImage[]; compact?: boolean; saver?: boolean }) {
  const [open, setOpen] = useState<number | null>(null)
  if (images.length === 0) return null
  const single = images.length === 1
  const first = images[0]!
  // Very tall or very wide photos are cropped to the middle, not shown at full height.
  const ratio = single ? Math.min(Math.max(first.width / first.height, 4 / 5), 2) : 16 / 9

  return (
    <>
      <div
        className={`post-images ${compact ? 'is-compact' : ''}`}
        data-count={images.length}
        style={{ aspectRatio: ratio }}
      >
        {images.map((image, i) => (
          <Tile key={image.src} image={image} label={`View ${image.animated ? 'GIF' : 'image'} ${i + 1} of ${images.length}${image.alt.trim() ? `: ${image.alt.trim()}` : ''}`} sizes={single ? '(max-width: 640px) 100vw, 560px' : '(max-width: 640px) 50vw, 280px'} saver={saver} onOpen={() => setOpen(i)} />
        ))}
      </div>
      {/* Keep the top-layer viewer outside feed cards and their layout/interaction styles. */}
      {open !== null ? createPortal(<ImageViewer images={images} start={open} saver={saver} onClose={() => setOpen(null)} />, document.body) : null}
    </>
  )
}

/** One image in the grid; a GIF has a pause button beside its link, since a button cannot sit inside one. */
function Tile({ image, label, sizes, saver, onOpen }: { image: PostImage; label: string; sizes: string; saver: boolean; onOpen: () => void }) {
  const [playing, toggle] = useGif()
  // Saving data: nothing is fetched until the reader taps. Without JavaScript the
  // placeholder is a plain link to the small version, so it still works. The tap
  // is the reader's own choice, so a GIF then plays as it would for anyone else.
  const [loaded, setLoaded] = useState(false)
  const still = image.animated && !playing
  if (saver && !loaded) {
    const kind = image.animated ? 'GIF' : 'image'
    return (
      <a
        href={`${image.src}/640.webp`}
        target="_blank"
        rel="noopener"
        className="post-image media-held"
        // The name starts with the visible words (WCAG 2.5.3 Label in Name).
        aria-label={`Tap to load ${label.replace(/^View /, '')}`}
        onClick={(e) => {
          if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return
          e.preventDefault()
          setLoaded(true)
        }}
      >
        <span className="media-held-label">{`Tap to load ${kind}`}</span>
        {image.alt.trim() ? <span className="media-held-alt">{image.alt.trim()}</span> : null}
      </a>
    )
  }
  const link = (
    <a
      href={`${image.src}/1600.webp`}
      target="_blank"
      rel="noopener"
      className={image.animated ? 'post-image-link' : 'post-image'}
      aria-label={label}
      onClick={(e) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return
        e.preventDefault()
        onOpen()
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- already resized to the sizes we need */}
      <img
        src={`${image.src}/${still ? 'still' : '640'}.webp`}
        srcSet={still || saver ? undefined : `${image.src}/640.webp 640w, ${image.src}/1600.webp 1600w`}
        sizes={sizes}
        alt={image.alt}
        width={image.width}
        height={image.height}
        loading="lazy"
        decoding="async"
      />
    </a>
  )
  if (!image.animated) return link
  return (
    <div className="post-image is-animated">
      {link}
      <GifToggle playing={playing} onToggle={toggle} />
    </div>
  )
}

/**
 * Full-screen viewer on a native modal <dialog>: it traps focus, closes on Escape,
 * and hands focus back to the image that opened it. Arrow keys and swipes move
 * between images.
 */
function ImageViewer({ images, start, saver, onClose }: { images: PostImage[]; start: number; saver: boolean; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const [index, setIndex] = useState(start)
  const swipeFrom = useRef<{ x: number; y: number; id: number } | null>(null)
  const swiped = useRef(false)
  const many = images.length > 1
  const image = images[index]!
  const reduced = useReducedMotion()
  // Chosen per GIF, so pausing one does not pause the next.
  const [chosen, setChosen] = useState<Record<string, boolean>>({})
  const playing = chosen[image.src] ?? (!reduced && !saver)
  const go = (step: number) => setIndex((i) => (i + step + images.length) % images.length)

  // No cleanup: removing the element closes the dialog, while calling close()
  // would fire `close` and shut a viewer that development mode had just reopened.
  useEffect(() => {
    if (!dialog.current?.open) dialog.current?.showModal()
  }, [])

  return (
    // The dialog's own `close` event covers Escape and the close button alike.
    <dialog
      ref={dialog}
      className="image-viewer"
      aria-label={many ? `Image ${index + 1} of ${images.length}` : 'Image'}
      onClose={onClose}
      onKeyDown={(e) => {
        if (!many) return
        if (e.key === 'ArrowLeft') go(-1)
        if (e.key === 'ArrowRight') go(1)
      }}
      onClick={(e) => {
        if (swiped.current) {
          swiped.current = false
          return
        }
        // A tap on the dark area around the image closes it.
        if (e.target === e.currentTarget || (e.target as HTMLElement).classList.contains('image-viewer-stage')) {
          dialog.current?.close()
        }
      }}
    >
      <div
        className="image-viewer-stage"
        onPointerDown={(e) => {
          if (!many || !e.isPrimary || e.button !== 0) return
          swiped.current = false
          swipeFrom.current = { x: e.clientX, y: e.clientY, id: e.pointerId }
        }}
        onPointerUp={(e) => {
          const from = swipeFrom.current
          swipeFrom.current = null
          if (!from || from.id !== e.pointerId) return
          const dx = e.clientX - from.x
          const dy = e.clientY - from.y
          if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy)) {
            // Prevent the click following a swipe from closing the backdrop.
            swiped.current = true
            e.preventDefault()
            go(dx < 0 ? 1 : -1)
          }
        }}
        onPointerCancel={() => { swipeFrom.current = null }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- the stored large version */}
        <img
          key={image.src}
          src={image.animated && !playing ? `${image.src}/still.webp` : `${image.src}/1600.webp`}
          alt={image.alt}
          width={image.width}
          height={image.height}
          draggable={false}
        />
      </div>

      <div className="image-viewer-bar">
        {many ? (
          <span className="tabular-nums" aria-hidden="true">
            {index + 1} / {images.length}
          </span>
        ) : null}
        {image.animated ? (
          <GifToggle playing={playing} onToggle={() => setChosen((all) => ({ ...all, [image.src]: !playing }))} className="is-viewer" />
        ) : null}
        {image.alt ? <p className="image-viewer-caption">{image.alt}</p> : null}
      </div>

      <button type="button" className="image-viewer-btn is-close" aria-label="Close" autoFocus onClick={() => dialog.current?.close()}>
        <CloseIcon size={22} />
      </button>
      {many ? (
        <>
          <button type="button" className="image-viewer-btn is-prev" aria-label="Previous image" onClick={() => go(-1)}>
            <PreviousIcon size={24} />
          </button>
          <button type="button" className="image-viewer-btn is-next" aria-label="Next image" onClick={() => go(1)}>
            <NextIcon size={24} />
          </button>
        </>
      ) : null}
    </dialog>
  )
}
