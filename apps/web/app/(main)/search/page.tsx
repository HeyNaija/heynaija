import type { Metadata } from 'next'
import Link from 'next/link'
import { Suspense } from 'react'
import { Avatar } from '@/app/ui/avatar'
import { EmptyState } from '@/app/ui/empty-state'
import { SearchIcon } from '@/app/ui/icons'
import { JoinButton } from '@/app/ui/join-button'
import { PostList, PostsSkeleton } from '@/app/ui/post-item'
import { getViewer, search } from '@/lib/api'

export const metadata: Metadata = { title: 'Search' }

export default function SearchPage({ searchParams }: PageProps<'/search'>) {
  return (
    <div className="flex flex-col gap-3">
      <h1 className="page-title">Search</h1>
      <Suspense fallback={<PostsSkeleton />}>
        <Results searchParams={searchParams} />
      </Suspense>
    </div>
  )
}

async function Results({ searchParams }: Pick<PageProps<'/search'>, 'searchParams'>) {
  const { q: raw } = await searchParams
  const q = typeof raw === 'string' ? raw.trim().slice(0, 80) : ''
  const [results, viewer] = await Promise.all([q ? search(q) : null, getViewer()])
  const viewerId = viewer.state === 'member' ? viewer.me.id : null
  const nothing = results && !results.members.length && !results.communities.length && !results.posts.length

  return (
    <>
      {/* The top bar has a search box on wide screens; phones use this one. */}
      <form action="/search" role="search">
        <label className="square-search !max-w-none">
          <SearchIcon size={18} />
          <span className="sr-only">Search</span>
          <input
            type="search"
            name="q"
            defaultValue={q}
            required
            minLength={2}
            maxLength={80}
            placeholder="Search people, posts, communities…"
            className="min-w-0 flex-1 bg-transparent text-base text-ink placeholder:text-muted focus:outline-none"
          />
        </label>
      </form>

      {!q ? (
        <p className="py-8 text-center text-sm text-muted">Search for a handle, a community, or words from a post.</p>
      ) : !results ? (
        <p className="py-8 text-center text-sm text-muted">Type at least two characters to search.</p>
      ) : nothing ? (
        <EmptyState icon={<SearchIcon size={22} />} title={`Nothing found for “${q}”`}>
          Check the spelling, or try a handle, a community name, or a different word.
        </EmptyState>
      ) : (
        <>
          {results.members.length ? (
            <section className="border-b border-line px-1 pb-4">
              <h2 className="section-title">People</h2>
              <ul className="mt-3 flex flex-col gap-3">
                {results.members.map((m) => (
                  <li key={m.handle}>
                    <Link href={`/u/${m.handle}`} className="flex items-center gap-3 font-semibold hover:underline">
                      <Avatar handle={m.handle} size={36} />@{m.handle}
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {results.communities.length ? (
            <section className="border-b border-line px-1 pb-4">
              <h2 className="section-title">Communities</h2>
              <ul className="mt-3 flex flex-col gap-3">
                {results.communities.map((c) => (
                  <li key={c.slug} className="flex items-center gap-3">
                    <Avatar handle={c.name} size={36} />
                    <div className="min-w-0 flex-1">
                      <Link href={`/c/${c.slug}`} className="font-semibold hover:underline">
                        {c.name}
                      </Link>
                      <p className="truncate text-sm text-muted">{c.description}</p>
                    </div>
                    {viewerId ? <JoinButton slug={c.slug} joined={c.viewerIsMember} compact /> : null}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {results.posts.length ? (
            <section aria-label="Posts" className="flex flex-col gap-1">
              <h2 className="section-title px-1">Posts</h2>
              <PostList posts={results.posts} viewerId={viewerId} now={Date.now()} empty={{ title: 'No posts' }} olderHref={null} />
            </section>
          ) : null}
        </>
      )}
    </>
  )
}
