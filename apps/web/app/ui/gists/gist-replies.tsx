import { setGistReplyAudience } from '@/app/actions'
import { DotsIcon } from '@/app/ui/icons'
import { Menu } from '@/app/ui/menu'
import { SubmitButton } from '@/app/ui/submit-button'
import { ThreadBranch, ThreadConversation } from '@/app/ui/thread-conversation'
import { renderThreadRow } from '@/app/ui/thread-row'
import Link from 'next/link'
import type { GistReplies as GistRepliesPage, Post, ReplyPage } from '@/lib/api'
import { GIST_REPLY_AUDIENCE_LABEL, GIST_REPLY_AUDIENCES, gistReplyAudienceNote } from '@/lib/reply-audience'
import type { ReplyOrder } from '@/lib/thread-state'

export function GistReplies({
  gistId,
  hostHandle,
  page,
  viewer,
  writable,
  order,
  focus,
}: {
  gistId: string
  hostHandle: string
  page: GistRepliesPage
  viewer: { id: string; handle: string; avatar: string | null }
  /** The gistReplies flag: off stops new replies and leaves the ones there to read. */
  writable: boolean
  order: ReplyOrder
  /** One reply opened as the conversation, with the replies under it: answers land under it. */
  focus?: { post: Post; page: ReplyPage }
}) {
  const now = Date.now()
  const gist = { id: gistId, viewerIsHost: page.viewerIsHost, order }
  const canReply = writable && page.viewerCanReply
  return (
    <section id="gist-replies" className="gist-replies flex flex-col gap-3" aria-label="Replies to this Gist">
      {page.viewerIsHost ? (
        <div className="gist-reply-controls">
          <Menu label="Who can reply" trigger={<DotsIcon size={18} />} panelClassName="thread-options-panel">
            <p className="thread-options-label">Who can reply</p>
            {GIST_REPLY_AUDIENCES.map((audience) => (
              <form action={setGistReplyAudience} key={audience}>
                <input type="hidden" name="gist" value={gistId} />
                <input type="hidden" name="audience" value={audience} />
                <SubmitButton className="menu-item" pressed={page.replyAudience === audience}>
                  {GIST_REPLY_AUDIENCE_LABEL[audience]}
                </SubmitButton>
              </form>
            ))}
          </Menu>
        </div>
      ) : null}
      {page.replyAudience !== 'everyone' ? (
        <p className="reply-audience-note">{gistReplyAudienceNote(page.replyAudience, hostHandle, page.viewerIsHost)}</p>
      ) : null}
      {focus ? (
        <p className="thread-recipient">
          <Link href={`/gists/${gistId}${order === 'oldest' ? '?replies=oldest' : ''}#gist-replies`}>All replies to this Gist</Link>
        </p>
      ) : null}
      <ThreadConversation
        key={`${viewer.id}:${gistId}:${focus?.post.id ?? ''}:${order}`}
        focus={focus ? { id: focus.post.id, parentId: focus.post.replyParentId, handle: focus.post.authorHandle, depth: 0 } : { id: gistId, parentId: null, handle: hostHandle, depth: 0 }}
        gist={gistId}
        member={canReply ? { handle: viewer.handle, avatar: viewer.avatar } : null}
        limited={!canReply}
        limitedNote={writable ? 'The host has limited who can reply.' : 'Replies are paused for now.'}
        initialRows={(focus?.page ?? page).replies.map((post) => renderThreadRow(post, viewer.id, now, 1, focus?.post.authorHandle ?? hostHandle, false, gist))}
        cursor={(focus?.page ?? page).cursor}
        order={order}
        version={now}
      >
        {focus ? (
          renderThreadRow(focus.post, viewer.id, now, 0, hostHandle, true, gist).node
        ) : (
          <ThreadBranch id={gistId} parentId={null} handle={hostHandle} replyCount={page.count} hasReplies depth={0} root>
            <></>
          </ThreadBranch>
        )}
      </ThreadConversation>
    </section>
  )
}
