import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { Suspense } from 'react'
import { EmptyState } from '@/app/ui/empty-state'
import { HashIcon } from '@/app/ui/icons'
import { PostsSkeleton } from '@/app/ui/post-item'
import { TopicList } from '@/app/ui/topic-list'
import { getTrendingTopics, type TopicRules } from '@/lib/api'
import { topicPeriod } from '@/lib/topics'

export const metadata: Metadata = {
  title: 'Trending topics',
  description: 'The hashtags most members of HeyNaija are using, and the rules that decide them.',
}

export default function TopicsPage() {
  return (
    <div className="page-stack">
      <header className="page-intro">
        <p className="page-eyebrow">Explore HeyNaija</p>
        <h1 className="page-title">Trending topics</h1>
        <p className="page-description">
          The hashtags most members are using, counted by a few plain rules that are the same for everyone.
        </p>
      </header>
      <Suspense fallback={<PostsSkeleton />}>
        <Topics />
      </Suspense>
    </div>
  )
}

async function Topics() {
  const trending = await getTrendingTopics()
  // Switched off (a feature flag): the page does not exist.
  if (!trending) notFound()
  const { topics, rules } = trending
  const period = topicPeriod(rules.windowDays)

  return (
    <>
      {topics.length ? (
        <section className="content-panel" aria-labelledby="topic-list">
          <div className="section-heading">
            <h2 id="topic-list" className="section-title">{period[0]!.toUpperCase() + period.slice(1)}</h2>
            <span className="text-xs text-muted">{topics.length === 1 ? '1 topic' : `${topics.length} topics`}</span>
          </div>
          <TopicList topics={topics} rules={rules} />
        </section>
      ) : (
        <div className="content-panel">
          <EmptyState icon={<HashIcon size={24} />} title="No topics are trending yet">
            A hashtag is listed here once {rules.minMembers} different members have used it {period}.
          </EmptyState>
        </div>
      )}
      <HowTopicsAreChosen rules={rules} />
    </>
  )
}

/** The rules, in words, with the numbers the API applies. */
function HowTopicsAreChosen({ rules }: { rules: TopicRules }) {
  const days = rules.windowDays === 1 ? 'day' : `${rules.windowDays} days`
  const refresh = rules.refreshSeconds === 60 ? 'about once a minute' : `about every ${rules.refreshSeconds} seconds`
  return (
    <section id="how" className="content-panel" aria-labelledby="topic-rules">
      <h2 id="topic-rules" className="section-title">How topics are chosen</h2>
      <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm leading-relaxed text-muted">
        <li>A topic is a hashtag in a post or reply. Every spelling is the same topic: #EndSARS and #endsars count together.</li>
        <li>
          Topics are ranked by how many different members used them in the last {days}. Using a hashtag many times
          still counts as one member, so a few busy accounts cannot outrank many people.
        </li>
        <li>A hashtag needs at least {rules.minMembers} different members to be listed, so nobody can make a topic trend alone.</li>
        <li>When two topics have as many members, the one in more posts comes first, then the one used most recently.</li>
        <li>Deleted posts, posts taken down by moderators and posts by suspended members do not count.</li>
        <li>
          The list is the same for everyone. It does not depend on who you follow, block or mute, and nobody picks topics
          by hand. It is worked out again {refresh}.
        </li>
      </ol>
    </section>
  )
}
