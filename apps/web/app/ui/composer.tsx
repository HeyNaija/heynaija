'use client'

import { useActionState, useEffect, useRef, useState } from 'react'
import { type ComposeState, createPost } from '@/app/actions'
import { Avatar } from './avatar'
import { CloseIcon, ImageIcon, PeopleIcon } from './icons'
import { IMAGE_TYPES } from './shrink-image'
import { type ImageDraft, MAX_IMAGES, useImageDrafts } from './use-image-drafts'

const LIMIT = 300
const segmenter = new Intl.Segmenter()
const graphemes = (text: string) => [...segmenter.segment(text)].length

type Props = {
  /** The member writing; shown as their avatar. */
  handle: string
  avatar?: string | null
  replyTo?: string
  placeholder?: string
  /** Post straight into this community (used on a community's own page). */
  community?: string
  /** Or let the member choose among the communities they have joined. */
  choices?: { slug: string; name: string }[]
}

export function Composer({ handle, avatar, replyTo, placeholder = "What's on your mind?", community, choices }: Props) {
  const [state, action, pending] = useActionState<ComposeState, FormData>(createPost, {})
  const [text, setText] = useState('')
  const [expanded, setExpanded] = useState(false)
  const images = useImageDrafts()
  const { clear } = images
  const picker = useRef<HTMLInputElement>(null)
  const form = useRef<HTMLFormElement>(null)

  // A press anywhere outside the form shrinks the box back. On press rather than
  // on blur: Safari does not focus buttons, so a blur would shrink the form under
  // the pointer and swallow a click on the image button.
  useEffect(() => {
    const outside = (e: PointerEvent) => {
      if (!form.current?.contains(e.target as Node)) setExpanded(false)
    }
    document.addEventListener('pointerdown', outside)
    return () => document.removeEventListener('pointerdown', outside)
  }, [])
  const [tooMany, setTooMany] = useState(false)

  // Clear the box once the server confirms the post.
  useEffect(() => {
    if (state.postedAt) {
      setText('')
      clear()
    }
  }, [state.postedAt, clear])

  const left = LIMIT - graphemes(text.trim())
  const waiting = images.drafts.some((d) => d.status !== 'ready')
  const empty = left === LIMIT && images.drafts.length === 0

  return (
    <form ref={form} id="compose" action={action} className="square-card square-composer scroll-mt-24">
      {replyTo ? <input type="hidden" name="replyTo" value={replyTo} /> : null}
      {community ? <input type="hidden" name="community" value={community} /> : null}

      <div className="flex gap-3">
        <Avatar handle={handle} src={avatar} />
        <div className="min-w-0 flex-1">
          <label htmlFor="post-text" className="sr-only">
            {replyTo ? 'Your reply' : 'New post'}
          </label>
          <textarea
            id="post-text"
            name="text"
            rows={replyTo ? 2 : expanded || text || images.drafts.length ? 3 : 1}
            onFocus={() => setExpanded(true)}
            onBlur={(e) => {
              // Tabbing away from the form shrinks it; clicks are handled above.
              const next = e.relatedTarget as Node | null
              if (next && !form.current?.contains(next)) setExpanded(false)
            }}
            required={images.drafts.length === 0}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={placeholder}
            className="composer-input"
          />

          {images.drafts.length ? (
            <ul className="composer-images" aria-label="Images">
              {images.drafts.map((draft, i) => (
                <DraftRow
                  key={draft.key}
                  draft={draft}
                  index={i}
                  onRemove={() => {
                    setTooMany(false)
                    images.remove(draft.key)
                  }}
                  onDescribe={(alt) => images.describe(draft.key, alt)}
                />
              ))}
            </ul>
          ) : null}

          <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2">
            <button
              type="button"
              className="icon-btn -ml-2"
              aria-label={`Add images (up to ${MAX_IMAGES})`}
              title="Add images"
              disabled={images.drafts.length >= MAX_IMAGES}
              onClick={() => picker.current?.click()}
            >
              <ImageIcon size={20} />
            </button>
            <input
              ref={picker}
              type="file"
              multiple
              accept={IMAGE_TYPES.join(',')}
              className="sr-only"
              tabIndex={-1}
              aria-hidden="true"
              onChange={(e) => {
                const files = [...(e.target.files ?? [])]
                e.target.value = '' // so choosing the same file again still fires
                setExpanded(true)
                setTooMany(images.add(files) > 0)
              }}
            />
            {choices?.length ? (
              <label className="flex min-w-0 items-center gap-1.5 text-[13px] text-muted">
                <PeopleIcon size={18} />
                <span className="sr-only">Post to</span>
                <select
                  name="community"
                  defaultValue=""
                  className="min-w-0 max-w-44 rounded-lg bg-transparent py-1 text-[13px] font-semibold text-ink"
                >
                  <option value="">Everyone</option>
                  {choices.map((c) => (
                    <option key={c.slug} value={c.slug}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>
            ) : replyTo ? null : (
              <span className="flex items-center gap-1.5 text-[13px] font-medium text-muted">
                <PeopleIcon size={18} />
                {community ? 'Posting to this community' : 'Everyone'}
              </span>
            )}
            <span className={`ml-auto text-xs tabular-nums ${left < 0 ? 'text-danger' : 'text-muted'}`}>{left}</span>
            <button
              type="submit"
              disabled={pending || left < 0 || empty || waiting}
              className="btn btn-primary"
            >
              {pending ? 'Posting…' : replyTo ? 'Reply' : 'Post'}
            </button>
          </div>

          <p className="mt-2 text-xs text-muted">Posts are public. Anyone can see and copy them.</p>
          <p role="alert" className="mt-1 text-sm text-danger empty:hidden">
            {tooMany ? `A post can have up to ${MAX_IMAGES} images. The rest were left out.` : state.error}
          </p>
        </div>
      </div>
    </form>
  )
}

const STATUS: Record<ImageDraft['status'], string> = {
  uploading: 'Uploading…',
  processing: 'Processing…',
  ready: '',
  failed: '',
}

/** One attached image: its preview, its description, and how its upload is going. */
function DraftRow({
  draft,
  index,
  onRemove,
  onDescribe,
}: {
  draft: ImageDraft
  index: number
  onRemove: () => void
  onDescribe: (alt: string) => void
}) {
  const id = `alt-${draft.key}`
  return (
    <li className="composer-image">
      {/* eslint-disable-next-line @next/next/no-img-element -- a local preview of the member's own file */}
      <img src={draft.preview} alt="" className={`composer-thumb ${draft.status === 'ready' ? '' : 'is-busy'}`} />
      <div className="min-w-0 flex-1">
        <label htmlFor={id} className="sr-only">
          Description of image {index + 1}
        </label>
        <input
          id={id}
          // Named only once the upload exists, so the server can match it to the image.
          name={draft.mediaId ? `alt-${draft.mediaId}` : undefined}
          value={draft.alt}
          onChange={(e) => onDescribe(e.target.value)}
          maxLength={1000}
          placeholder="Describe this image (optional)"
          className="field field-sm"
        />
        {draft.status === 'ready' && draft.mediaId ? <input type="hidden" name="image" value={draft.mediaId} /> : null}
        {draft.error ? (
          <p role="alert" className="mt-1 text-xs text-danger">
            {draft.error}
          </p>
        ) : (
          <p role="status" className="mt-1 text-xs text-muted empty:hidden">
            {STATUS[draft.status]}
          </p>
        )}
      </div>
      <button type="button" className="icon-btn -mr-1" aria-label={`Remove image ${index + 1}`} onClick={onRemove}>
        <CloseIcon size={18} />
      </button>
    </li>
  )
}
