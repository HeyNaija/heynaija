import { setGistReplyAudience } from '@/app/actions'
import { DotsIcon } from '@/app/ui/icons'
import { Menu } from '@/app/ui/menu'
import { SubmitButton } from '@/app/ui/submit-button'
import { ThreadBranch, ThreadConversation } from '@/app/ui/thread-conversation'
import { renderThreadRow } from '@/app/ui/thread-row'
import type { GistReplies as GistRepliesPage } from '@/lib/api'
import { GIST_REPLY_AUDIENCE_LABEL, GIST_REPLY_AUDIENCES } from '@/lib/reply-audience'
import type { ReplyOrder } from '@/lib/thread-state'

export function GistReplies({
  gistId,
  hostHandle,
  page,
  viewer,
  writable,
  order,
}: {
  gistId: string
  hostHandle: string
  page: GistRepliesPage
  viewer: { id: string; handle: string; avatar: string | null }
  /** The gistReplies flag: off stops new replies and leaves the ones there to read. */
  writable: boolean
  order: ReplyOrder
}) {
  const now = Date.now()
  const gist = { id: gistId, viewerIsHost: page.viewerIsHost }
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
        <p className="reply-audience-note">{GIST_REPLY_AUDIENCE_LABEL[page.replyAudience]}</p>
      ) : null}
      <ThreadConversation
        key={`${viewer.id}:${gistId}:${order}`}
        focus={{ id: gistId, parentId: null, handle: hostHandle, depth: 0 }}
        gist={gistId}
        member={canReply ? { handle: viewer.handle, avatar: viewer.avatar } : null}
        limited={!canReply}
        limitedNote={writable ? 'The host has limited who can reply.' : 'Replies are paused for now.'}
        initialRows={page.replies.map((post) => renderThreadRow(post, viewer.id, now, 1, hostHandle, false, gist))}
        cursor={page.cursor}
        order={order}
        version={now}
      >
        <ThreadBranch id={gistId} parentId={null} handle={hostHandle} replyCount={page.count} hasReplies depth={0} root>
          <></>
        </ThreadBranch>
      </ThreadConversation>
    </section>
  )
}
