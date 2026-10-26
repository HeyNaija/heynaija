'use client'

import Link from 'next/link'
import { createContext, type MouseEvent, type ReactNode, useCallback, useContext, useEffect, useRef, useState, useTransition } from 'react'
import type { ComposeState } from '@/app/actions'
import { createThreadReply, loadThreadReplies } from '@/app/thread-actions'
import {
  appendReplyPage,
  type BranchCache,
  canRenderThreadChildren,
  emptyBranch,
  insertConfirmedReply,
  nextThreadPath,
  pruneCollapsedBranches,
  type ReplyOrder,
  type ReplyTarget,
  type ThreadRow,
  THREAD_MAX_DEPTH,
} from '@/lib/thread-state'
import { Composer } from './composer'
import { BubbleIcon, DotsIcon } from './icons'
import { Menu } from './menu'

type Position = { id: string; parentId: string | null; handle: string | null; depth: number }
type ConversationContext = {
  order: ReplyOrder
  branches: BranchCache
  increments: Record<string, number>
  canReply: boolean
  posting: boolean
  select: (target: ReplyTarget) => void
  load: (position: Position, more?: boolean) => void
  collapse: (id: string) => void
  /** The reply editor, drawn by the branch in focus. */
  editor: ReactNode
}
const Conversation = createContext<ConversationContext | null>(null)
const BranchAncestry = createContext<readonly string[]>([])

const plainClick = (event: MouseEvent<HTMLAnchorElement>) =>
  !event.defaultPrevented && event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey

/** Only branch state and the one editor live in the browser; post content remains server rendered. */
export function ThreadConversation({
  focus,
  member,
  initialRows,
  cursor,
  order,
  version,
  children,
}: {
  focus: ReplyTarget
  member: { handle: string; avatar: string | null } | null
  initialRows: ThreadRow[]
  cursor: string | null
  /** Every list of replies on the page, the focus's and each branch's, is in this order. */
  order: ReplyOrder
  version: number
  children: ReactNode
}) {
  const initial = useCallback((): BranchCache => ({
    [focus.id]: { ...emptyBranch(null), items: initialRows, cursor, loaded: true, open: true, touched: Date.now() },
  }), [focus.id, initialRows, cursor])
  const [branches, setBranches] = useState<BranchCache>(initial)
  const [increments, setIncrements] = useState<Record<string, number>>({})
  const [target, setTarget] = useState(focus)
  const [focusRequest, setFocusRequest] = useState(0)
  const [portalTarget, setPortalTarget] = useState<HTMLElement | null>(null)
  const [posting, setPosting] = useState(false)
  const [, startTransition] = useTransition()
  const cache = useRef(branches)
  cache.current = branches
  const selected = useRef(target)
  selected.current = target
  const generation = useRef(0)
  const mounted = useRef(true)
  const busy = useRef(new Set<string>())
  const posted = useRef(new Set<string>())
  const revision = useRef(version)

  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false; generation.current++ }
  }, [])

  // A server refresh follows delete/block/mute. Discard personalized cached rows,
  // while the mounted Composer retains its text and uploads.
  useEffect(() => {
    if (revision.current === version) return
    revision.current = version
    generation.current++
    busy.current.clear()
    setBranches(initial())
    setIncrements({})
  }, [version, initial])

  // The editor is drawn under the post in focus, by the server too, so loading
  // the page never moves it. Replying to another post on screen moves it there;
  // the move replaces its elements, and the Composer puts focus back.
  const lastFocus = useRef(0)
  useEffect(() => {
    const selectedHost = target.id === focus.id ? null : document.getElementById(`thread-editor-${target.id}`)
    const host = selectedHost && !selectedHost.closest('[hidden]') ? selectedHost : null
    setPortalTarget((current) => current === host ? current : host)
    const shown = host ?? document.getElementById(`thread-editor-${focus.id}`)
    if (focusRequest && focusRequest !== lastFocus.current && shown) {
      lastFocus.current = focusRequest
      shown.scrollIntoView({ block: 'nearest', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' })
    }
  }, [target, branches, focus.id, focusRequest])

  const select = useCallback((next: ReplyTarget) => {
    if (posting) return
    // The synchronous focus opens the phone keyboard inside the user's tap.
    document.querySelector<HTMLTextAreaElement>('#compose textarea')?.focus({ preventScroll: true })
    setTarget(next)
    setFocusRequest((request) => request + 1)
  }, [posting])

  const collapse = useCallback((id: string) => {
    setBranches((current) => {
      const branch = current[id]
      if (!branch) return current
      return pruneCollapsedBranches({ ...current, [id]: { ...branch, open: false, touched: Date.now() } }, focus.id, selected.current)
    })
  }, [focus.id])

  const load = useCallback((position: Position, more = false) => {
    const current = cache.current[position.id] ?? emptyBranch(position.parentId)
    const gen = generation.current
    const request = `${gen}:${position.id}`
    if (busy.current.has(request)) return
    if (current.loaded && !more) {
      setBranches((all) => ({ ...all, [position.id]: { ...all[position.id], open: true, touched: Date.now() } }))
      return
    }
    if (more && !current.cursor) return
    const next = current.loaded ? current.cursor : null
    busy.current.add(request)
    setBranches((all) => ({
      ...all,
      [position.id]: { ...(all[position.id] ?? current), open: true, status: 'loading', error: undefined, touched: Date.now() },
    }))
    startTransition(async () => {
      const result = await loadThreadReplies(position.id, next, position.depth + 1, position.handle, order)
        .catch(() => ({ error: 'Replies could not be loaded. Check your connection and try again.' }))
      busy.current.delete(request)
      if (!mounted.current || gen !== generation.current) return
      startTransition(() => setBranches((all) => {
        const branch = all[position.id]
        if (!branch) return all
        const updated = 'error' in result
          ? { ...branch, status: 'error' as const, error: result.error }
          : { ...appendReplyPage(branch, result.rows, result.cursor), error: undefined, touched: Date.now() }
        return pruneCollapsedBranches({ ...all, [position.id]: updated }, focus.id, selected.current)
      }))
    })
  }, [focus.id, order])

  const onPosted = useCallback((state: ComposeState) => {
    if (!state.postId || posted.current.has(state.postId)) return
    posted.current.add(state.postId)
    if (!state.reply) return
    const { parentId, row } = state.reply
    setIncrements((current) => ({ ...current, [parentId]: (current[parentId] ?? 0) + 1 }))
    setBranches((current) => {
      const parent = current[parentId] ?? emptyBranch(selected.current.id === parentId ? selected.current.parentId : null)
      return {
        ...current,
        [parentId]: { ...insertConfirmedReply(parent, row, order), touched: Date.now() },
      }
    })
  }, [order])

  const editor = member ? (
    <Composer
      handle={member.handle}
      avatar={member.avatar}
      replyTo={target.id}
      replyHandle={target.handle}
      replyDepth={target.depth + 1}
      placeholder="Write a reply…"
      submitAction={createThreadReply}
      onPosted={onPosted}
      onPendingChange={setPosting}
      portalTarget={portalTarget}
      focusRequest={focusRequest}
    />
  ) : null

  return (
    <Conversation.Provider value={{ order, branches, increments, canReply: member !== null, posting, select, load, collapse, editor }}>
      {children}
    </Conversation.Provider>
  )
}

/** The normal anchor remains usable without JavaScript and with modifier keys. */
export function ThreadReplyAction({ id, parentId, handle, depth, count }: ReplyTarget & { count: number }) {
  const context = useContext(Conversation)
  const total = count + (context?.increments[id] ?? 0)
  return (
    <Link
      href={`/p/${id}#compose`}
      prefetch={false}
      className="icon-btn"
      aria-label={`Reply (${total === 1 ? '1 reply' : `${total} replies`})`}
      aria-disabled={context?.posting || undefined}
      onClick={(event) => {
        // A reply at the limit would not be drawn in this view, so open the post to answer it.
        if (!plainClick(event) || !context?.canReply || depth >= THREAD_MAX_DEPTH) return
        event.preventDefault()
        context.select({ id, parentId, handle, depth })
      }}
    >
      <BubbleIcon size={18} />
      <span className="tabular-nums">{total}</span>
    </Link>
  )
}

export function ThreadBranch({
  id,
  parentId,
  handle,
  parentHandle,
  replyCount,
  hasReplies,
  depth,
  root = false,
  children,
}: Position & {
  parentHandle: string | null
  replyCount: number | null
  hasReplies: boolean
  root?: boolean
  children: ReactNode
}) {
  const context = useContext(Conversation)
  const ancestors = useContext(BranchAncestry)
  const path = nextThreadPath(ancestors, id)
  if (!path) {
    return (
      <p className="thread-context-note" role="note">
        This conversation returns to an earlier post.{' '}
        <Link prefetch={false} href={`/p/${id}`}>Continue conversation</Link>
      </p>
    )
  }
  const renderChildren = canRenderThreadChildren(depth, path.length, !handle)
  const state = context?.branches[id]
  const busy = state?.status === 'loading'
  const items = state?.items ?? []
  const recent = state?.recent ?? []
  const total = (replyCount ?? 0) + (context?.increments[id] ?? 0)
  const empty = state?.loaded && items.length === 0 && recent.length === 0
  const expandable = !empty && (hasReplies || total > 0 || items.length > 0 || recent.length > 0)
  const open = root || state?.open === true
  const position = { id, parentId, handle, depth }
  const order = context?.order ?? 'newest'

  return (
    <BranchAncestry.Provider value={path}>
    <div className={`thread-branch ${root ? 'is-root' : ''}`} data-thread-id={id} data-parent-id={parentId ?? ''} data-depth={depth}>
      {depth > 1 && parentId && (!handle || !parentHandle || handle !== parentHandle) ? (
        <p className="thread-recipient">
          <Link href={`/p/${parentId}#post-${parentId}`} prefetch={false}>
            {parentHandle ? `Replying to @${parentHandle}` : 'Replying to an earlier post'}
          </Link>
        </p>
      ) : null}
      <div className="thread-row">{children}</div>
      {/* The editor stays in the focused branch's tree, so it keeps its text
          and uploads wherever it is shown. Nothing moves it to an unavailable
          post, so that host has no id. */}
      {handle || root ? (
        <div id={handle ? `thread-editor-${id}` : undefined} className="thread-editor-host">{root ? context?.editor : null}</div>
      ) : null}

      {!root && expandable ? (
        <div className="thread-controls">
          {!renderChildren ? (
            <Link prefetch={false} href={`/p/${id}`} className="thread-toggle">Continue conversation</Link>
          ) : (
            <Link
              href={`/p/${id}#replies-${id}`}
              prefetch={false}
              className="thread-toggle"
              aria-controls={`replies-${id}`}
              aria-expanded={open}
              aria-busy={busy || undefined}
              onClick={(event) => {
                if (!plainClick(event) || !context) return
                event.preventDefault()
                if (busy) return
                if (open && state?.loaded) context.collapse(id)
                else context.load(position)
              }}
            >
              {busy ? 'Loading replies…' : open && state?.loaded ? 'Hide replies' : 'View replies'}
            </Link>
          )}
        </div>
      ) : null}

      {renderChildren && (root || state) ? (
        <section id={`replies-${id}`} className="thread-children" aria-label={root ? 'Replies' : `Replies${handle ? ` to @${handle}` : ' to unavailable post'}`} hidden={!open} aria-busy={busy || undefined}>
          {root ? <RepliesHeading id={id} handle={handle} order={order} ordered={items.length + recent.length > 0 || !!state?.cursor} /> : null}
          {items.length ? <ul className="thread-list">{items.map((row) => <li key={row.id}>{row.node}</li>)}</ul> : null}
          {empty ? <p className="thread-empty">{root && total === 0 ? 'No replies yet.' : 'No available replies.'}</p> : null}
          {recent.length ? (
            <div className="thread-recent">
              <p className="thread-gap">Your reply · Some replies are not loaded yet.</p>
              <ul className="thread-list">{recent.map((row) => <li key={row.id}>{row.node}</li>)}</ul>
            </div>
          ) : null}
          {state?.error ? <p role="alert" className="thread-error">{state.error}</p> : null}
          {state?.cursor || state?.status === 'error' ? (
            <Link
              href={`/p/${id}${replyQuery(order, state.cursor)}#replies-${id}`}
              prefetch={false}
              className="thread-more btn btn-secondary btn-sm"
              aria-disabled={busy || undefined}
              onClick={(event) => {
                if (!plainClick(event) || !context) return
                event.preventDefault()
                context.load(position, state.loaded)
              }}
            >
              {busy ? 'Loading replies…' : state.status === 'error' ? 'Try again' : 'More replies'}
            </Link>
          ) : null}
        </section>
      ) : null}
    </div>
    </BranchAncestry.Provider>
  )
}

/** The page's address for an order and, for reading on without JavaScript, a page of replies. */
function replyQuery(order: ReplyOrder, cursor: string | null) {
  const query = new URLSearchParams()
  if (order === 'oldest') query.set('replies', 'oldest')
  if (cursor) query.set('repliesCursor', cursor)
  return query.size ? `?${query}` : ''
}

/** Keep reading controls together, out of the way until the reader asks for them. */
function RepliesHeading({ id, handle, order, ordered }: { id: string; handle: string | null; order: ReplyOrder; ordered: boolean }) {
  return (
    <div className="thread-replies-head">
      <h2 className="thread-replies-heading">Replies</h2>
      {ordered ? (
        <Menu label="Reply options" trigger={<DotsIcon size={18} />} panelClassName="thread-options-panel">
          <nav aria-label="Order of replies" className="thread-order">
            <p className="thread-options-label">Order replies</p>
            {(['newest', 'oldest'] as const).map((value) => (
              <Link
                key={value}
                href={`/p/${id}${replyQuery(value, null)}#replies-${id}`}
                prefetch={false}
                aria-current={value === order ? 'true' : undefined}
                className="menu-item"
              >
                {value === 'newest' ? 'Newest first' : 'Oldest first'}
              </Link>
            ))}
          </nav>
          <p className="thread-order-rule">
            <strong>Author replies first.</strong>{' '}
            {handle ? `@${handle}'s` : "The author's"} own replies come first, then everyone else's, {order} first.
            Under each reply, its author's replies come first the same way. Nothing is ranked by likes or reach.
          </p>
        </Menu>
      ) : null}
    </div>
  )
}
