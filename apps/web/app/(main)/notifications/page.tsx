import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { type ReactNode, Suspense } from 'react'
import { Avatar } from '@/app/ui/avatar'
import { EmptyState } from '@/app/ui/empty-state'
import { BellIcon, BubbleIcon, FlagIcon, FollowIcon, HeartIcon, ShieldIcon } from '@/app/ui/icons'
import { MarkRead } from '@/app/ui/mark-read'
import { PostsSkeleton } from '@/app/ui/post-item'
import { timeAgo } from '@/app/ui/time'
import { getNotifications, getViewer, type Notification } from '@/lib/api'
import { notificationTarget } from '@/lib/notification-target'

export const metadata: Metadata = { title: 'Notifications' }

export default function NotificationsPage({ searchParams }: PageProps<'/notifications'>) {
  return (
    <div className="flex flex-col gap-3">
      <h1 className="page-title">Notifications</h1>
      <Suspense fallback={<PostsSkeleton />}>
        <Notifications searchParams={searchParams} />
      </Suspense>
    </div>
  )
}

async function Notifications({ searchParams }: Pick<PageProps<'/notifications'>, 'searchParams'>) {
  const viewer = await getViewer()
  if (viewer.state !== 'member') redirect('/login')

  const { cursor } = await searchParams
  const page = typeof cursor === 'string' ? cursor : undefined
  const data = await getNotifications(page)
  if (!data) redirect('/login')
  const now = Date.now()
  const newestUnread = page ? undefined : data.notifications.find((n) => !n.read)

  if (data.notifications.length === 0) {
    return (
      <EmptyState icon={<BellIcon size={22} />} title={page ? 'No older notifications' : 'Nothing yet'}>
        {page ? null : 'When people reply to you, like your posts or follow you, it shows up here.'}
      </EmptyState>
    )
  }

  return (
    <>
      {/* Newest first, so the first unread one is the newest the member has now seen. */}
      {newestUnread ? <MarkRead upTo={data.notifications[0]!.id} /> : null}
      <ul className="post-list">
        {data.notifications.map((n) => (
          <li key={n.id}>
            <NotificationRow notification={n} now={now} />
          </li>
        ))}
      </ul>
      {data.cursor ? (
        <Link href={`/notifications?cursor=${encodeURIComponent(data.cursor)}`} className="btn btn-secondary btn-block mt-4">
          Older notifications
        </Link>
      ) : null}
    </>
  )
}

// How a report reason reads after "removed your post for".
const REASONS: Record<string, string> = {
  spam: 'spam',
  harassment: 'harassment',
  hate: 'hate speech',
  scam: 'being a scam',
  illegal: 'illegal content',
  other: 'breaking the community rules',
}

function describe(n: Notification): { icon: ReactNode; text: ReactNode } {
  const who = n.actor ? <strong className="font-semibold">{n.actor.displayName ?? `@${n.actor.handle}`}</strong> : null
  switch (n.kind) {
    case 'reply':
      return { icon: <BubbleIcon size={18} />, text: <>{who} replied to your post</> }
    case 'like':
      return { icon: <HeartIcon size={18} filled />, text: <>{who} liked your post</> }
    case 'follow':
      return { icon: <FollowIcon size={18} />, text: <>{who} followed you</> }
    case 'post_removed':
      return {
        icon: <ShieldIcon size={20} />,
        text: <>A moderator removed your post for {REASONS[n.detail ?? ''] ?? REASONS.other}.</>,
      }
    case 'post_restored':
      return { icon: <ShieldIcon size={18} />, text: <>A moderator restored your post.</> }
    case 'report_resolved': {
      const about = n.subjectHandle ? `@${n.subjectHandle}` : 'a post'
      return {
        icon: <FlagIcon size={20} />,
        text:
          n.detail === 'actioned'
            ? `Thanks for your report about ${about}. A moderator took action.`
            : `Thanks for your report about ${about}. A moderator looked and found no rule was broken.`,
      }
    }
    case 'avatar_removed':
      return {
        icon: <ShieldIcon size={20} />,
        text: 'A moderator removed your profile photo because it broke the community rules. You can add a different one.',
      }
    case 'profile_cleared':
      return {
        icon: <ShieldIcon size={20} />,
        text: 'A moderator cleared your name and bio because they broke the community rules. You can write new ones.',
      }
    case 'moderator_granted':
      return {
        icon: <ShieldIcon size={20} />,
        text: <>You are now a moderator of {n.community?.name ?? 'a community'}. Reports about its posts will reach you.</>,
      }
    case 'moderator_revoked':
      return {
        icon: <ShieldIcon size={20} />,
        text: <>You are no longer a moderator of {n.community?.name ?? 'a community'}.</>,
      }
    case 'account_reinstated':
      return { icon: <ShieldIcon size={18} />, text: 'Your account is active again. A moderator lifted the suspension.' }
  }
}

function NotificationRow({ notification: n, now }: { notification: Notification; now: number }) {
  const { icon, text } = describe(n)
  const href = notificationTarget(n)
  const body = (
    <>
      <span className={`notification-icon is-${n.kind}`}>{icon}</span>
      {n.actor ? <Avatar handle={n.actor.handle} src={n.actor.avatar} size={28} /> : null}
      <div className="min-w-0 flex-1">
        <p className="text-sm leading-5">
          {text}{' '}
          <time dateTime={n.createdAt} className="text-[13px] text-muted">
            · {timeAgo(n.createdAt, now)}
          </time>
        </p>
        {n.post?.excerpt ? <p className="mt-1 line-clamp-2 break-words text-[13px] leading-5 text-muted">{n.post.excerpt}</p> : null}
        {href ? <span className="notification-destination">{n.kind === 'reply' ? 'View reply' : n.kind === 'follow' ? 'View profile' : n.post ? 'View post' : 'View details'} →</span> : null}
      </div>
      {n.read ? null : (
        <span className="notification-dot">
          <span className="sr-only">Unread</span>
        </span>
      )}
    </>
  )
  const className = `notification-row ${n.read ? '' : 'is-unread'}`
  return href ? (
    <Link href={href} className={className}>
      {body}
    </Link>
  ) : (
    <div className={className}>{body}</div>
  )
}
