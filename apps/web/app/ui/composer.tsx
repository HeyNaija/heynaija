'use client'

import { type KeyboardEvent, type ReactNode, useActionState, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import Link from 'next/link'
import { Globe } from 'lucide-react'
import { type ComposeState, createPost } from '@/app/actions'
import { insertMention, mentionBeforeCaret } from '@/lib/mention-suggest'
import { POLL_OPTION_INPUT_MAX, POLL_OPTIONS_MAX } from '@/lib/polls'
import type { ReplyAudience } from '@/lib/reply-audience'
import { Avatar } from './avatar'
import { FounderBadge } from './founder-badge'
import { BubbleIcon, CloseIcon, GifIcon, ImageIcon, PeopleIcon, PlusIcon, VoteIcon } from './icons'
import { IMAGE_TYPES } from './shrink-image'
import { useAutoGrow } from './use-auto-grow'
import { type ImageDraft, MAX_IMAGES, useImageDrafts } from './use-image-drafts'
import { useMentionSuggestions } from './use-mention-suggestions'

const LIMIT = 300
const segmenter = new Intl.Segmenter()
const graphemes = (text: string) => [...segmenter.segment(text)].length

type Props = {
  /** The member writing; shown as their avatar. */
  handle: string
  avatar?: string | null
  replyTo?: string
  replyHandle?: string
  replyDepth?: number
  placeholder?: string
  /** Post straight into this community (used on a community's own page). */
  community?: string
  /** Or let the member choose among the communities they have joined. */
  choices?: { slug: string; name: string }[]
  /** Makes this a quote post of that post, shown under the box as `preview`. */
  quote?: { id: string; preview: ReactNode }
  submitAction?: (previous: ComposeState, data: FormData) => Promise<ComposeState>
  onPosted?: (state: ComposeState) => void
  onPendingChange?: (pending: boolean) => void
  /** The Composer stays mounted when its form moves to another reply row. */
  portalTarget?: HTMLElement | null
  focusRequest?: number
}

export function Composer({ handle, avatar, replyTo, replyHandle, replyDepth, placeholder, community, choices, quote, submitAction, onPosted, onPendingChange, portalTarget, focusRequest = 0 }: Props) {
  const inputId = useId()
  const privacyId = `${inputId}-privacy`
  const recipientId = `${inputId}-recipient`
  const [state, action, pending] = useActionState<ComposeState, FormData>(submitAction ?? createPost, {})
  const [text, setText] = useState('')
  // The prompt follows the audience picker; the toolbar keeps visibility and posting explicit.
  const [audience, setAudience] = useState('')
  const [replyAudience, setReplyAudience] = useState<ReplyAudience>('everyone')
  const [pollOpen, setPollOpen] = useState(false)
  const [pollOptions, setPollOptions] = useState(['', ''])
  const [pollMultiple, setPollMultiple] = useState(false)
  const [pollExpiry, setPollExpiry] = useState('7_days')
  const prompt = placeholder ?? (audience ? `Start a conversation in ${choices?.find((c) => c.slug === audience)?.name ?? 'your community'}…` : 'Start a conversation…')
  const [expanded, setExpanded] = useState(false)
  const images = useImageDrafts()
  const { clear } = images
  const picker = useRef<HTMLInputElement>(null)
  const form = useRef<HTMLFormElement>(null)
  const input = useRef<HTMLTextAreaElement>(null)
  // A quote keeps the box open: the post being quoted is shown under it.
  const active = expanded || text.length > 0 || images.drafts.length > 0 || !!quote || pollOpen
  const rows = active ? (replyTo ? 2 : 3) : 1
  useAutoGrow(input, text, rows)

  // The @mention being typed at the caret, and members to offer for it.
  const mentionsId = `${inputId}-mentions`
  const [caret, setCaret] = useState(0)
  const [dismissed, setDismissed] = useState<number | null>(null)
  const [picked, setPicked] = useState(0)
  const typing = mentionBeforeCaret(text, caret)
  const mentions = useMentionSuggestions(typing?.query ?? null)
  const suggestions = mentions.list
  const suggesting = !!typing && suggestions.length > 0 && dismissed !== typing.start && !pending
  const choice = Math.min(picked, suggestions.length - 1)
  const nextCaret = useRef<number | null>(null)
  const mentionList = useRef<HTMLUListElement>(null)
  useEffect(() => {
    setPicked(0)
    mentionList.current?.scrollTo({ top: 0 })
  }, [typing?.query])
  useLayoutEffect(() => {
    if (nextCaret.current === null) return
    input.current?.setSelectionRange(nextCaret.current, nextCaret.current)
    nextCaret.current = null
  }, [text])

  const pickMention = (handle: string) => {
    if (!typing) return
    const next = insertMention(text, typing, caret, handle)
    nextCaret.current = next.caret
    setText(next.text)
    setCaret(next.caret)
  }

  const onMentionKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (!suggesting || !typing || e.nativeEvent.isComposing) return
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      const step = e.key === 'ArrowDown' ? 1 : -1
      // At the last row with more to come, loads them instead of wrapping to the top.
      if (step === 1 && choice === suggestions.length - 1 && mentions.more) {
        mentions.loadMore()
        return
      }
      const next = (choice + step + suggestions.length) % suggestions.length
      setPicked(next)
      // Keeps the highlighted member in view, including the wrap from last to first.
      mentionList.current?.children[next]?.scrollIntoView({ block: 'nearest' })
    } else if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault()
      pickMention(suggestions[choice]!.handle)
    } else if (e.key === 'Escape') {
      e.preventDefault()
      setDismissed(typing.start)
    }
  }

  // Arriving through a "Reply" or "New post" link (…#compose) puts the cursor in the box.
  useEffect(() => {
    if (window.location.hash === '#compose' || focusRequest > 0) input.current?.focus({ preventScroll: true })
  }, [portalTarget, focusRequest])

  useEffect(() => { onPendingChange?.(pending) }, [pending, onPendingChange])

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

  // React resets the form when an action finishes, and a <select> then shows its
  // first option whatever its state says (text fields keep theirs). Drawing the
  // selects afresh after each result puts the member's choices back, on screen
  // and in the form a retry sends.
  const [results, setResults] = useState(0)
  useEffect(() => setResults((n) => n + 1), [state])

  // Clear the box once the server confirms the post.
  const lastPosted = useRef<number | undefined>(undefined)
  useEffect(() => {
    if (state.postedAt && lastPosted.current !== state.postedAt) {
      lastPosted.current = state.postedAt
      setText('')
      setAudience('')
      setReplyAudience('everyone')
      setPollOpen(false)
      setPollOptions(['', ''])
      setPollMultiple(false)
      setPollExpiry('7_days')
      clear()
      setExpanded(false)
      onPosted?.(state)
    }
  }, [state, clear, onPosted])

  /** Opens the file picker offering only `types`: photos, or GIFs. */
  const choose = (types: string[]) => {
    if (!picker.current) return
    picker.current.accept = types.join(',')
    picker.current.click()
  }

  const left = LIMIT - graphemes(text.trim())
  const waiting = images.drafts.some((d) => d.status !== 'ready')
  const empty = left === LIMIT && images.drafts.length === 0
  const pollReady = !pollOpen || (text.trim().length > 0 && pollOptions.length >= 2 && pollOptions.every((option) => option.trim().length > 0))

  const content = (
    <form ref={form} id="compose" action={action} className={`${replyTo ? 'reply-composer is-reply' : 'square-composer square-card'} ${active ? 'is-expanded' : ''} scroll-mt-32`}>
      {replyTo ? <input type="hidden" name="replyTo" value={replyTo} /> : null}
      {replyDepth ? <input type="hidden" name="threadDepth" value={replyDepth} /> : null}
      {replyHandle ? <input type="hidden" name="replyHandle" value={replyHandle} /> : null}
      {community ? <input type="hidden" name="community" value={community} /> : null}
      {quote ? <input type="hidden" name="quote" value={quote.id} /> : null}
      {!replyTo ? <input type="hidden" name="replyAudience" value={replyAudience} /> : null}
      {pollOpen ? <input type="hidden" name="poll" value="1" /> : null}

      {replyTo && replyHandle ? (
        <p id={recipientId} className="composer-recipient">Replying to <strong>@{replyHandle}</strong></p>
      ) : null}
      <div className={replyTo ? 'composer-reply-writing' : 'flex gap-3'}>
        {replyTo ? (
          <div className="composer-reply-avatar" title={`Replying as @${handle}`}>
            <Avatar handle={handle} src={avatar} size={32} />
            <span className="sr-only">Replying as @{handle}</span>
          </div>
        ) : (
          <Avatar handle={handle} src={avatar} size={42} />
        )}
        <div className="min-w-0 flex-1">
          <label htmlFor={inputId} className="sr-only">
            {replyTo ? 'Your reply' : 'New post'}
          </label>
          <div className="composer-writing-row">
            <textarea
              ref={input}
              id={inputId}
              name="text"
              rows={rows}
              onFocus={() => setExpanded(true)}
              onBlur={(e) => {
                // Tabbing away from the form shrinks it; clicks are handled above.
                const next = e.relatedTarget as Node | null
                if (next && !form.current?.contains(next)) setExpanded(false)
              }}
              required={images.drafts.length === 0}
              disabled={pending}
              value={text}
              onChange={(e) => {
                setText(e.target.value)
                setCaret(e.target.selectionStart)
              }}
              onSelect={(e) => setCaret(e.currentTarget.selectionStart)}
              onKeyDown={onMentionKey}
              placeholder={prompt}
              className="composer-input"
              aria-describedby={replyTo && replyHandle ? `${recipientId} ${privacyId}` : privacyId}
              aria-invalid={left < 0 || undefined}
              aria-autocomplete="list"
              aria-controls={suggesting ? mentionsId : undefined}
              aria-activedescendant={suggesting ? `${mentionsId}-${choice}` : undefined}
            />
            {suggesting ? (
              <ul
                ref={mentionList}
                id={mentionsId}
                role="listbox"
                aria-label="Members to mention"
                aria-busy={mentions.loading || undefined}
                className="mention-list"
                // Asks for the next page a couple of rows before the end.
                onScroll={(e) => {
                  const ul = e.currentTarget
                  if (ul.scrollHeight - ul.scrollTop - ul.clientHeight < 120) mentions.loadMore()
                }}
              >
                {suggestions.map((m, i) => (
                  <li
                    key={m.handle}
                    id={`${mentionsId}-${i}`}
                    role="option"
                    aria-selected={i === choice}
                    className="mention-option"
                    // Keeps focus (and the caret) in the box.
                    onPointerDown={(e) => e.preventDefault()}
                    onClick={() => pickMention(m.handle)}
                    onPointerEnter={() => setPicked(i)}
                  >
                    <Avatar handle={m.handle} src={m.avatar} size={36} />
                    <span className="min-w-0 flex-1">
                      <span className="flex min-w-0 items-center gap-1.5">
                        <span className="truncate font-semibold">{m.displayName ?? `@${m.handle}`}</span>
                        {m.founder ? <FounderBadge plain size={14} /> : null}
                      </span>
                      {m.displayName ? <span className="block truncate text-[13px] text-muted">@{m.handle}</span> : null}
                      {m.following ? <span className="block text-xs text-muted">Following</span> : null}
                    </span>
                  </li>
                ))}
                {mentions.loading ? (
                  <li role="presentation" className="mention-loading">
                    Loading…
                  </li>
                ) : null}
              </ul>
            ) : null}
          </div>

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
          {quote ? <div className="composer-quote">{quote.preview}</div> : null}
        </div>
      </div>
      {pollOpen ? (
        <fieldset className="composer-poll">
          <legend>Poll choices</legend>
          <div className="composer-poll-options">
            {pollOptions.map((option, index) => (
              <div key={index} className="composer-poll-option">
                <label className="sr-only" htmlFor={`${inputId}-poll-${index}`}>Choice {index + 1}</label>
                <input
                  id={`${inputId}-poll-${index}`}
                  name="pollOption"
                  value={option}
                  required
                  maxLength={POLL_OPTION_INPUT_MAX}
                  placeholder={`Choice ${index + 1}`}
                  onChange={(event) => setPollOptions((current) => current.map((value, at) => at === index ? event.target.value : value))}
                />
                {pollOptions.length > 2 ? (
                  <button
                    type="button"
                    className="icon-btn"
                    aria-label={`Remove choice ${index + 1}`}
                    onClick={() => setPollOptions((current) => current.filter((_, at) => at !== index))}
                  >
                    <CloseIcon size={17} />
                  </button>
                ) : null}
              </div>
            ))}
          </div>
          {pollOptions.length < POLL_OPTIONS_MAX ? (
            <button type="button" className="composer-poll-add" onClick={() => setPollOptions((current) => [...current, ''])}>
              <PlusIcon size={16} /> Add choice
            </button>
          ) : null}
          <div className="composer-poll-settings">
            <label>
              <span>Voting</span>
              <select key={results} name="pollMultiple" value={pollMultiple ? '1' : '0'} onChange={(event) => setPollMultiple(event.target.value === '1')}>
                <option value="0">Choose one</option>
                <option value="1">Choose more than one</option>
              </select>
            </label>
            <label>
              <span>Ends</span>
              <select key={results} name="pollExpiry" value={pollExpiry} onChange={(event) => setPollExpiry(event.target.value)}>
                <option value="1_day">In 1 day</option>
                <option value="3_days">In 3 days</option>
                <option value="7_days">In 7 days</option>
                <option value="30_days">In 30 days</option>
                <option value="never">Never</option>
              </select>
            </label>
          </div>
          <p>Votes and voter names are public. A submitted ballot cannot be changed.</p>
        </fieldset>
      ) : null}
      <div className="composer-toolbar">
        <button
          type="button"
          className="icon-btn composer-photo"
          aria-label={`Add images (up to ${MAX_IMAGES})`}
          title="Add images"
          disabled={images.drafts.length >= MAX_IMAGES}
          onClick={() => choose(IMAGE_TYPES)}
        >
          <ImageIcon size={20} />
          <span className="composer-photo-label">Photo</span>
        </button>
        <button
          type="button"
          className="icon-btn composer-photo"
          aria-label={`Add a GIF (the post can have up to ${MAX_IMAGES} pictures in all)`}
          title="Add a GIF"
          disabled={images.drafts.length >= MAX_IMAGES}
          onClick={() => choose(['image/gif'])}
        >
          <GifIcon size={20} />
          <span className="composer-photo-label">GIF</span>
        </button>
        {/* One hidden picker for both buttons; each says what it will offer before it opens. */}
        <input
          ref={picker}
          type="file"
          multiple
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
        {!replyTo ? (
          <button
            type="button"
            className="icon-btn composer-photo"
            aria-pressed={pollOpen}
            onClick={() => { setPollOpen((open) => !open); setExpanded(true) }}
          >
            <VoteIcon size={20} />
            <span className="composer-photo-label">Poll</span>
          </button>
        ) : null}
        {choices?.length ? (
          <label className="composer-audience">
            <PeopleIcon size={18} />
            <span className="sr-only">Post to</span>
            <select
              key={results}
              name="community"
              value={audience}
              onChange={(e) => setAudience(e.target.value)}
              className="min-w-0 max-w-36 rounded-lg bg-transparent py-1 text-xs font-medium text-muted"
            >
              <option value="">Public · Everyone</option>
              {choices.map((c) => (
                <option key={c.slug} value={c.slug}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <span className="composer-audience">
            <Globe size={16} aria-hidden="true" />
            {community ? 'This community' : 'Public'}
          </span>
        )}
        {!replyTo ? (
          <label className="composer-audience">
            <BubbleIcon size={16} />
            <span className="sr-only">Who can reply</span>
            <select key={results} value={replyAudience} onChange={(event) => setReplyAudience(event.target.value as ReplyAudience)}>
              <option value="everyone">Everyone can reply</option>
              <option value="following">People you follow</option>
              <option value="mentioned">Only people mentioned</option>
            </select>
          </label>
        ) : null}
        {active ? (
          <span className={`composer-count text-xs tabular-nums ${left < 0 ? 'text-danger' : 'text-muted'}`}>
            <span aria-hidden="true">{left < 0 ? `${-left} over` : `${left} left`}</span>
            {/* Spoken only near the limit, so screen readers are not read a number per keystroke. */}
            <span role="status" className="sr-only">
              {left <= 20 ? (left < 0 ? `${-left} characters over the limit` : `${left} characters left`) : ''}
            </span>
          </span>
        ) : null}
        <button
          type="submit"
          disabled={pending || left < 0 || empty || waiting || !pollReady}
          className="btn btn-primary btn-sm composer-submit"
        >
          {pending ? 'Posting…' : replyTo ? 'Reply' : 'Post'}
        </button>
      </div>

      <p id={privacyId} className="composer-privacy">
        {replyTo ? 'Replies' : 'Posts'} are public. Anyone can see and copy them.
        {!replyTo && replyAudience !== 'everyone' ? ' This post limits who may join its replies.' : ''}
      </p>
      <p role="alert" className="mt-1 text-sm text-danger empty:hidden">
        {tooMany ? `A post can have up to ${MAX_IMAGES} images. The rest were left out.` : state.error}
      </p>
      {submitAction && state.postId ? (
        <p role="status" className="composer-posted">
          Reply posted. <Link prefetch={false} href={`/p/${state.postId}#post-${state.postId}`}>View reply</Link>
        </p>
      ) : null}
    </form>
  )
  return portalTarget ? createPortal(content, portalTarget) : content
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
          Description of {draft.gif ? 'GIF' : 'image'} {index + 1}
        </label>
        <input
          id={id}
          // Named only once the upload exists, so the server can match it to the image.
          name={draft.mediaId ? `alt-${draft.mediaId}` : undefined}
          value={draft.alt}
          onChange={(e) => onDescribe(e.target.value)}
          maxLength={1000}
          placeholder={`Describe this ${draft.gif ? 'GIF' : 'image'} (optional)`}
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
      <button type="button" className="icon-btn -mr-1" aria-label={`Remove ${draft.gif ? 'GIF' : 'image'} ${index + 1}`} onClick={onRemove}>
        <CloseIcon size={18} />
      </button>
    </li>
  )
}
