import type { Metadata } from 'next'
import Link from 'next/link'
import { Suspense } from 'react'
import { Avatar } from '@/app/ui/avatar'
import { CommunityMark } from '@/app/ui/community-mark'
import { EmptyState } from '@/app/ui/empty-state'
import { ArrowUpRightIcon, SearchIcon } from '@/app/ui/icons'
import { JoinButton } from '@/app/ui/join-button'
import { PostList, PostsSkeleton } from '@/app/ui/post-item'
import { getViewer, search } from '@/lib/api'
import { hashtagHref, hashtagIn } from '@/lib/hashtags'

export const metadata: Metadata = { title: 'Search' }

export default function SearchPage({ searchParams }: PageProps<'/search'>) {
  return (
    <div className="page-stack">
      <header className="page-intro">
        <p className="page-eyebrow">Explore HeyNaija</p>
        <h1 className="page-title">Search</h1>
        <p className="page-description">Find members, communities and conversations that matter to you.</p>
      </header>
      <Suspense fallback={<PostsSkeleton />}>
        <Results searchParams={searchParams} />
      </Suspense>
    </div>
  )
}

async function Results({ searchParams }: Pick<PageProps<'/search'>, 'searchParams'>) {
  const { q: raw } = await searchParams
  const q = typeof raw === 'string' ? raw.trim().slice(0, 80) : ''
  const [results, viewer] = await Promise.all([q.length >= 2 ? search(q) : null, getViewer()])
  const viewerId = viewer.state === 'member' ? viewer.me.id : null
  // Searching for "#EndSARS" also offers the hashtag's own page, which has every post with it.
  const tag = hashtagIn(q)
  const nothing = results && !results.members.length && !results.communities.length && !results.posts.length

  return (
    <>
      <form action="/search" role="search" className="search-form">
        <label className="square-search !max-w-none flex-1">
          <SearchIcon size={18} />
          <span className="sr-only">Search members, posts and communities</span>
          <input
            type="search"
            name="q"
            defaultValue={q}
            required
            minLength={2}
            maxLength={80}
            placeholder="Members, posts, communities…"
            className="min-w-0 flex-1 bg-transparent text-base text-ink placeholder:text-muted focus:outline-none"
          />
        </label>
        <button type="submit" className="btn btn-primary">Search</button>
      </form>

      {!q ? (
        <div className="content-panel">
          <EmptyState
            icon={<SearchIcon size={24} />}
            title="Follow your curiosity"
            action={<Link href="/c" className="btn btn-secondary">Explore communities</Link>}
          >
            Try a member’s handle, a community name or a few words from a post.
          </EmptyState>
        </div>
      ) : !results ? (
        <div className="content-panel">
          <EmptyState icon={<SearchIcon size={24} />} title="A little more to go on">
            Type at least two characters to search.
          </EmptyState>
        </div>
      ) : nothing ? (
        <div className="content-panel">
          <EmptyState icon={<SearchIcon size={24} />} title={`Nothing found for “${q}”`}>
            Check the spelling, or try a handle, a community name or a different word.
          </EmptyState>
        </div>
      ) : (
        <>
          <p className="text-sm text-muted">Results for <span className="font-semibold text-ink">“{q}”</span></p>
          {tag ? (
            <section className="content-panel" aria-labelledby="hashtag-result">
              <div className="section-heading">
                <h2 id="hashtag-result" className="section-title">Hashtag</h2>
              </div>
              <ul className="result-list mt-3">
                <li>
                  <Link href={hashtagHref(tag)} className="result-row group">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-semibold group-hover:underline">#{tag}</span>
                      <span className="block truncate text-[13px] text-muted">Every post and reply with this hashtag</span>
                    </span>
                    <span className="text-muted"><ArrowUpRightIcon size={16} /></span>
                  </Link>
                </li>
              </ul>
            </section>
          ) : null}
          {results.members.length ? (
            <section className="content-panel" aria-labelledby="member-results">
              <div className="section-heading">
                <h2 id="member-results" className="section-title">Members</h2>
                <span className="text-xs text-muted">{results.members.length} shown</span>
              </div>
              <ul className="result-list mt-3">
                {results.members.map((m) => (
                  <li key={m.handle}>
                    <Link href={`/u/${m.handle}`} className="result-row group">
                      <Avatar handle={m.handle} src={m.avatar} size={40} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-semibold group-hover:underline">{m.displayName ?? `@${m.handle}`}</span>
                        {m.displayName ? <span className="block truncate text-[13px] text-muted">@{m.handle}</span> : null}
                      </span>
                      <span className="text-muted"><ArrowUpRightIcon size={16} /></span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {results.communities.length ? (
            <section className="content-panel" aria-labelledby="community-results">
              <div className="section-heading">
                <h2 id="community-results" className="section-title">Communities</h2>
                <span className="text-xs text-muted">{results.communities.length} shown</span>
              </div>
              <ul className="result-list mt-3">
                {results.communities.map((c) => (
                  <li key={c.slug} className="result-row">
                    <CommunityMark slug={c.slug} />
                    <div className="min-w-0 flex-1">
                      <Link href={`/c/${c.slug}`} className="font-semibold hover:underline">
                        {c.name}
                      </Link>
                      <p className="mt-1 line-clamp-2 text-sm leading-relaxed text-muted">{c.description}</p>
                    </div>
                    {viewerId ? <JoinButton slug={c.slug} joined={c.viewerIsMember} compact /> : null}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {results.posts.length ? (
            <section aria-labelledby="post-results" className="flex flex-col gap-3">
              <div className="section-heading">
                <h2 id="post-results" className="section-title">Posts</h2>
                <span className="text-xs text-muted">{results.posts.length} shown</span>
              </div>
              <PostList posts={results.posts} viewerId={viewerId} now={Date.now()} empty={{ title: 'No posts' }} />
            </section>
          ) : null}
        </>
      )}
    </>
  )
}
