import Link from 'next/link'
import { ARBITER_ONLY } from '@/lib/chess-arena'
import { notFound } from 'next/navigation'
import { Suspense } from 'react'
import { setCommunitySensitive } from '@/app/actions'
import { Composer } from '@/app/ui/composer'
import { JoinButton } from '@/app/ui/join-button'
import { CommunityMark } from '@/app/ui/community-mark'
import { CommunityPhotoEditor } from '@/app/ui/community-photo-editor'
import { PostItem, PostList, PostsSkeleton } from '@/app/ui/post-item'
import { SubmitButton } from '@/app/ui/submit-button'
import { type ChessTeam, getChessTeam, getCommunity, getCommunityPosts, getViewer } from '@/lib/api'
import { canMarkSensitive, composerOffersMark } from '@/lib/sensitive'

type Props = PageProps<'/c/[slug]'>

export default function CommunityPage(props: Props) {
  return (
    <Suspense fallback={<PostsSkeleton />}>
      <CommunityView {...props} />
    </Suspense>
  )
}

async function CommunityView({ params, searchParams }: Props) {
  const [{ slug }, { cursor }] = await Promise.all([params, searchParams])
  const page = typeof cursor === 'string' ? cursor : undefined

  const [community, viewer] = await Promise.all([getCommunity(slug), getViewer()])
  if (!community) notFound()
  const games = viewer.state === 'member' && Boolean(viewer.me.features.games)
  const [feed, chess] = await Promise.all([
    getCommunityPosts(community.slug, page),
    // Its Lichess team and tournaments (docs/adr/0028, phase 6), only for members with Games.
    games ? getChessTeam(community.slug).catch(() => null) : Promise.resolve(null),
  ])
  const viewerId = viewer.state === 'member' ? viewer.me.id : null
  const rules = community.rules.split('\n').filter((line) => line.trim())
  const now = Date.now()

  return (
    <div className="page-stack">
      {/* Rendered here rather than via metadata: the name is only known after the fetch. */}
      <title>{`${community.name} · HeyNaija`}</title>

      <header className="page-header community-header">
        <Link href="/c" className="page-eyebrow inline-flex min-h-8 items-center hover:underline">
          Communities
        </Link>
        <div className="mt-3 flex flex-wrap items-start gap-4">
          <div className="flex min-w-0 grow basis-52 items-center gap-4">
            <CommunityMark slug={community.slug} photo={community.photo} large priority />
            <div className="min-w-0 flex-1">
              <h1 className="page-title break-words">{community.name}</h1>
              <p className="mt-1 text-xs text-muted">{community.sensitive ? 'Sensitive community' : 'Public community'}</p>
            </div>
          </div>
          {viewerId ? <JoinButton slug={community.slug} joined={community.viewerIsMember} /> : null}
        </div>
        {community.viewerCanManagePhoto ? (
          <CommunityPhotoEditor
            slug={community.slug}
            hasPhoto={community.photo !== null}
            siteModerator={community.viewerIsSiteModerator}
          />
        ) : null}
        {/* Its moderators mark the whole community sensitive (ADR 0020); taking the mark off always works. */}
        {community.viewerCanMarkSensitive && (community.sensitive || (viewer.state === 'member' && canMarkSensitive(viewer.me))) ? (
          <form action={setCommunitySensitive} className="mt-3">
            <input type="hidden" name="slug" value={community.slug} />
            <input type="hidden" name="on" value={community.sensitive ? '0' : '1'} />
            <SubmitButton className="btn btn-secondary btn-sm">
              {community.sensitive ? 'Remove sensitive mark' : 'Mark community as sensitive'}
            </SubmitButton>
            <p className="field-hint mt-2">
              {community.sensitive
                ? 'Every post here is marked sensitive: only adults see this community, and pictures and video are covered.'
                : 'Every post here will be marked sensitive: only adults will see this community, and pictures and video will be covered.'}
            </p>
          </form>
        ) : null}
        {viewerId && community.photo && !community.viewerCanManagePhoto ? (
          <Link href={`/report?community=${community.slug}`} prefetch={false} className="mt-3 inline-flex min-h-8 items-center text-sm text-muted hover:underline">
            Report photo
          </Link>
        ) : null}
        <p className="mt-4 text-[15px] leading-relaxed text-muted">{community.description}</p>
        <p className="mt-4 text-sm leading-6 text-muted">
          <span className="font-semibold text-ink">{community.memberCount.toLocaleString('en-NG')}</span>{' '}
          {community.memberCount === 1 ? 'member' : 'members'}
          {community.moderators.length ? (
            <>
              {' · Moderated by '}
              {community.moderators.map((handle, i) => (
                <span key={handle}>
                  {i > 0 ? ', ' : ''}
                  <Link href={`/u/${handle}`} className="text-ink hover:underline">
                    @{handle}
                  </Link>
                </span>
              ))}
            </>
          ) : null}
        </p>

        {community.slug === 'building-heynaija' ? (
          <p className="mt-4 text-sm leading-6">
            Ideas and problem reports have their own{' '}
            <Link href="/ideas" className="font-semibold text-accent-strong hover:underline">board</Link>, where you can vote
            for them and follow each one from review to release.
          </p>
        ) : null}

        {chess ? <CommunityChessLine chess={chess} /> : null}

        {rules.length ? (
          <details className="community-rules mt-4 rounded-lg bg-panel px-4 py-3 text-sm">
            <summary className="min-h-6 cursor-pointer font-semibold">Community rules</summary>
            <ol className="mt-3 list-decimal space-y-2 pl-5 text-muted">
              {rules.map((rule) => (
                <li key={rule}>{rule}</li>
              ))}
            </ol>
          </details>
        ) : null}
      </header>

      {ARBITER_ONLY[community.slug] ? (
        // Chess Arena and Game Night (docs/adr/0028): The Arbiter starts the posts; members reply in them.
        <p className="notice">{ARBITER_ONLY[community.slug]}</p>
      ) : viewer.state === 'member' && community.viewerIsMember ? (
        <Composer
          handle={viewer.me.handle}
          avatar={viewer.me.avatar}
          community={community.slug}
          polls={viewer.me.features?.polls ?? false}
          replyControls={viewer.me.features?.replyControls ?? false}
          replyAudiences={viewer.me.replyAudiences}
          videoLimits={viewer.me.videoLimits ?? null}
          // Everything posted in a community marked sensitive is marked anyway.
          sensitiveLabels={!community.sensitive && composerOffersMark(viewer.me)}
          placeholder={`Say something to ${community.name}`}
        />
      ) : viewerId ? (
        <p className="notice">Join this community to post in it.</p>
      ) : (
        <p className="notice">
          <Link href="/login" className="font-semibold underline underline-offset-2">
            Sign in
          </Link>{' '}
          to join and post.
        </p>
      )}

      {/* The welcome or guidance its moderators keep first, above the conversations. */}
      {feed.pinned ? (
        <section aria-label="Pinned by the moderators">
          <PostItem post={feed.pinned} viewerId={viewerId} now={now} hideCommunity pinned="community" />
        </section>
      ) : null}

      <section aria-label={`Posts in ${community.name}`} className="flex flex-col gap-3">
        <div className="section-heading">
          <h2 className="section-title">Conversations</h2>
          <span className="text-xs text-muted">Latest first</span>
        </div>
        <PostList
          posts={feed.posts}
          viewerId={viewerId}
          now={now}
          hideCommunity
          empty={page ? { title: 'No older posts' } : {
            title: 'The conversation starts here',
            detail: community.viewerIsMember ? 'Share something with the community.' : 'Join this community to start a conversation.',
          }}
          more={{ source: { kind: 'community', slug: community.slug }, cursor: feed.cursor }}
        />
      </section>
    </div>
  )
}

/** "Chess on Lichess": the community's team and next tournament, or a moderator's way to set one up. */
function CommunityChessLine({ chess }: { chess: ChessTeam }) {
  const page = `/games/chess/teams/${chess.community.slug}`
  if (!chess.team) {
    if (!chess.you.communityModerator) return null
    return (
      <p className="mt-4 text-sm leading-6 text-muted">
        Run chess tournaments for this community on Lichess.{' '}
        <Link href={page} className="font-semibold text-accent-strong hover:underline">Set it up</Link>
      </p>
    )
  }
  const next = chess.tournaments.current[0]
  return (
    <p className="mt-4 text-sm leading-6 text-muted">
      Chess on Lichess:{' '}
      <a href={chess.team.url} className="text-ink hover:underline" target="_blank" rel="noopener noreferrer">
        {chess.team.name}
      </a>
      {next ? (
        <>
          {' · Next: '}
          <Link href={`/games/competitions/${next.id}`} className="text-ink hover:underline">{next.name}</Link>
        </>
      ) : null}
      {' · '}
      <Link href={page} className="font-semibold text-accent-strong hover:underline">
        {chess.you.communityModerator ? 'Manage' : 'Tournaments'}
      </Link>
    </p>
  )
}
