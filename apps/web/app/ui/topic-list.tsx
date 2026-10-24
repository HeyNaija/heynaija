import Link from 'next/link'
import { ArrowUpRightIcon } from '@/app/ui/icons'
import type { TopicRules, TrendingTopic } from '@/lib/api'
import { hashtagHref } from '@/lib/hashtags'
import { topicCounts } from '@/lib/topics'

/**
 * Trending topics in rank order, each with the counts that put it there. `compact`
 * is the side rail's list; otherwise each topic is a full-width row.
 */
export function TopicList({ topics, rules, compact }: { topics: TrendingTopic[]; rules: TopicRules; compact?: boolean }) {
  if (compact) {
    return (
      <ol className="mt-3 flex flex-col gap-3.5">
        {topics.map((topic, i) => (
          <li key={topic.tag} className="flex gap-3">
            <span className="w-4 shrink-0 pt-px text-sm font-bold tabular-nums text-muted">{i + 1}</span>
            <Link href={hashtagHref(topic.label)} className="group min-w-0">
              <span className="block truncate text-[13px] font-semibold leading-relaxed group-hover:underline">#{topic.label}</span>
              <span className="mt-0.5 block text-xs text-muted">{topicCounts(topic, rules)}</span>
            </Link>
          </li>
        ))}
      </ol>
    )
  }
  return (
    <ol className="result-list">
      {topics.map((topic, i) => (
        <li key={topic.tag}>
          <Link href={hashtagHref(topic.label)} className="result-row group">
            <span className="w-6 shrink-0 text-sm font-bold tabular-nums text-muted">{i + 1}</span>
            <span className="min-w-0 flex-1">
              <span className="block truncate font-semibold group-hover:underline">#{topic.label}</span>
              <span className="block truncate text-[13px] text-muted">{topicCounts(topic, rules)}</span>
            </span>
            <span className="text-muted"><ArrowUpRightIcon size={16} /></span>
          </Link>
        </li>
      ))}
    </ol>
  )
}
