import type { TopicRules, TrendingTopic } from './api'

/** The window topics are counted over, as a reader says it: "this week", "in the last 3 days". */
export function topicPeriod(windowDays: number) {
  if (windowDays === 1) return 'today'
  if (windowDays === 7) return 'this week'
  return `in the last ${windowDays} days`
}

/** Why a topic is where it is: "4 members · 6 posts this week". */
export function topicCounts(topic: TrendingTopic, rules: TopicRules) {
  const members = topic.members === 1 ? '1 member' : `${topic.members.toLocaleString('en-NG')} members`
  const posts = topic.posts === 1 ? '1 post' : `${topic.posts.toLocaleString('en-NG')} posts`
  return `${members} · ${posts} ${topicPeriod(rules.windowDays)}`
}
