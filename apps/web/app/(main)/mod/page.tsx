import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Suspense } from 'react'
import { resolveReport, restorePost } from '@/app/actions'
import { Avatar } from '@/app/ui/avatar'
import { CommunityMark } from '@/app/ui/community-mark'
import { EmptyState } from '@/app/ui/empty-state'
import { ShieldIcon } from '@/app/ui/icons'
import { LocalTime } from '@/app/ui/local-time'
import { ModeratorRoster } from '@/app/ui/moderator-roster'
import { PostImages } from '@/app/ui/post-images'
import { PostsSkeleton } from '@/app/ui/post-item'
import { SubmitButton } from '@/app/ui/submit-button'
import { getModeration, type LogEntry, type QueueItem } from '@/lib/api'

export const metadata: Metadata = { title: 'Moderation' }

const REASONS: Record<string, string> = {
  spam: 'Spam',
  harassment: 'Harassment',
  hate: 'Hate speech',
  scam: 'Scam',
  illegal: 'Illegal content',
  other: 'Other',
  appeal: 'Appeal',
}

const ACTIONS: Record<string, string> = {
  remove_post: 'removed a post',
  restore_post: 'restored a post',
  suspend_member: 'suspended',
  reinstate_member: 'reinstated',
  dismiss_report: 'dismissed a report',
  remove_avatar: 'removed the profile photo of',
  clear_profile: 'cleared the name and bio of',
  remove_community_photo: 'removed the community photo',
  grant_community_moderator: 'made a moderator:',
  revoke_community_moderator: 'removed as moderator:',
}

export default function ModerationPage() {
  return (
    <div className="page-stack">
      <header className="page-intro">
        <p className="page-eyebrow">Care for the community</p>
        <h1 className="page-title">Moderation</h1>
        <p className="page-description">Review reports, hear appeals, and keep a clear record of every decision.</p>
      </header>
      <Suspense fallback={<PostsSkeleton />}>
        <Moderation />
      </Suspense>
    </div>
  )
}

async function Moderation() {
  const data = await getModeration()
  // To anyone who is not a moderator this page does not exist.
  if (!data) notFound()
  const now = Date.now()

  return (
    <>
      <section aria-label="Open reports" className="flex flex-col gap-3">
        <h2 className="section-title px-1">
          Open reports <span className="font-normal text-muted">({data.queue.length})</span>
        </h2>
        {data.queue.length === 0 ? (
          <EmptyState icon={<ShieldIcon size={22} />} title="The queue is clear">
            New reports and appeals will show up here.
          </EmptyState>
        ) : (
          data.queue.map((item) => <Report key={item.id} item={item} now={now} siteWide={data.roster !== null} />)
        )}
      </section>

      {data.roster ? (
        <section aria-label="Community moderators" className="content-panel">
          <h2 className="section-title">Community moderators</h2>
          <div className="mt-3">
            <ModeratorRoster roster={data.roster} />
          </div>
        </section>
      ) : null}

      <section aria-label="Recent decisions" className="content-panel">
        <h2 className="section-title">Recent decisions</h2>
        {data.log.length === 0 ? (
          <p className="mt-2 text-sm text-muted">No decisions yet.</p>
        ) : (
          <ul className="mt-3 flex flex-col gap-3 text-sm">
            {data.log.map((entry) => (
              <Decision key={entry.id} entry={entry} now={now} />
            ))}
          </ul>
        )}
      </section>
    </>
  )
}

const button = 'btn btn-secondary btn-sm'
const danger = 'btn btn-danger btn-sm'

function Report({ item, now, siteWide }: { item: QueueItem; now: number; siteWide: boolean }) {
  const isAppeal = item.reason === 'appeal'
  // Every button submits the same form; its value is the decision.
  return (
    <form action={resolveReport} className="content-panel flex flex-col gap-4">
      <input type="hidden" name="id" value={item.id} />

      <p className="flex flex-wrap items-center gap-x-2 text-sm">
        <span className="chip">
          {REASONS[item.reason] ?? item.reason}
        </span>
        <span className="text-muted">
          {item.reporterHandle ? `${isAppeal ? 'from' : 'reported by'} @${item.reporterHandle}` : 'flagged by the upload scanner'} · <LocalTime at={item.createdAt} now={now} />
          {item.reportCount > 1 ? ` · ${item.reportCount} reports` : ''}
        </span>
      </p>

      {item.post ? (
        <blockquote className="rounded-lg bg-panel p-4 text-sm">
          <Link href={`/u/${item.post.authorHandle}`} className="font-semibold hover:underline">
            @{item.post.authorHandle}
          </Link>
          {item.post.communityName ? <span className="text-muted"> in {item.post.communityName}</span> : null}
          {item.post.text ? <p className="mt-1 whitespace-pre-wrap break-words">{item.post.text}</p> : null}
          {item.post.images.length ? (
            <div className="mt-2">
              <PostImages images={item.post.images} compact />
            </div>
          ) : null}
        </blockquote>
      ) : item.member ? (
        // The account as others see it: photo, name and bio are what get reported.
        <div className="flex gap-3 rounded-lg bg-panel p-4 text-sm">
          <Avatar handle={item.member.handle} src={item.member.avatar} size={48} />
          <div className="min-w-0">
            <p>
              {item.member.displayName ? <span className="font-semibold">{item.member.displayName} </span> : null}
              <Link href={`/u/${item.member.handle}`} className="text-muted hover:underline">
                @{item.member.handle}
              </Link>
              {item.member.active ? '' : ' (suspended)'}
            </p>
            {item.member.bio ? <p className="mt-1 whitespace-pre-wrap break-words">{item.member.bio}</p> : null}
          </div>
        </div>
      ) : item.communityPhoto ? (
        <div className="flex items-center gap-3 rounded-lg bg-panel p-4 text-sm">
          <CommunityMark slug={item.communityPhoto.slug} photo={item.communityPhoto.photo} large />
          <p>
            <Link href={`/c/${item.communityPhoto.slug}`} className="font-semibold hover:underline">
              {item.communityPhoto.name}
            </Link>
            <span className="text-muted"> community photo{item.communityPhoto.photo ? '' : ' (no longer set)'}</span>
          </p>
        </div>
      ) : null}

      {item.details ? (
        <p className="text-sm">
          {item.reporterHandle ? <span className="text-muted">{isAppeal ? 'They say: ' : 'Reporter says: '}</span> : null}
          {item.details}
        </p>
      ) : null}

      <label className="flex flex-col gap-1 text-sm">
        <span className="field-label">
          Note for the record <span className="font-normal text-muted">(optional)</span>
        </span>
        <input name="note" maxLength={500} className="field" />
      </label>

      <div className="flex flex-wrap gap-2">
        {isAppeal ? (
          <SubmitButton name="resolution" value="reinstate_member" className={button}>
            Reinstate account
          </SubmitButton>
        ) : (
          <>
            {item.post ? (
              <SubmitButton name="resolution" value="remove_post" className={danger}>
                Remove post
              </SubmitButton>
            ) : null}
            {item.communityPhoto && siteWide ? (
              <SubmitButton name="resolution" value="remove_community_photo" className={danger}>
                Remove photo
              </SubmitButton>
            ) : null}
            {item.member && !item.post && siteWide && item.member.avatar ? (
              <SubmitButton name="resolution" value="remove_avatar" className={button}>
                Remove photo
              </SubmitButton>
            ) : null}
            {item.member && !item.post && siteWide && (item.member.displayName || item.member.bio) ? (
              <SubmitButton name="resolution" value="clear_profile" className={button}>
                Clear name and bio
              </SubmitButton>
            ) : null}
            {item.communityPhoto ? null : (
              <SubmitButton
                name="resolution"
                value="suspend_member"
                className={danger}
                confirmMessage="Suspend this account? They will not be able to post until reinstated."
              >
                Suspend account
              </SubmitButton>
            )}
          </>
        )}
        <SubmitButton name="resolution" value="dismiss" className={button}>
          {isAppeal ? 'Reject appeal' : 'Dismiss'}
        </SubmitButton>
      </div>
    </form>
  )
}

function Decision({ entry, now }: { entry: LogEntry; now: number }) {
  return (
    <li className="flex flex-wrap items-baseline gap-x-2">
      <span>
        <span className="font-semibold">@{entry.actorHandle}</span> {ACTIONS[entry.action] ?? entry.action}
        {entry.memberHandle && entry.action !== 'dismiss_report' ? (
          <>
            {entry.action.endsWith('_post') ? ' by ' : ' '}
            <span className="font-medium">@{entry.memberHandle}</span>
          </>
        ) : null}
        {entry.communityName ? ` in ${entry.communityName}` : null}
      </span>
      <LocalTime at={entry.createdAt} now={now} className="text-muted" />
      {entry.note ? <span className="w-full text-muted">“{entry.note}”</span> : null}
      {entry.action === 'remove_post' && entry.postId ? (
        <form action={restorePost} className="w-full">
          <input type="hidden" name="id" value={entry.postId} />
          <SubmitButton className="text-xs font-semibold text-accent-strong hover:underline">Restore this post</SubmitButton>
        </form>
      ) : null}
    </li>
  )
}
