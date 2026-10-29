import type { Metadata } from 'next'
import Link from 'next/link'
import { Suspense } from 'react'
import { PostsSkeleton } from '@/app/ui/post-item'
import { type DiscoverRules, getDiscoverRules } from '@/lib/api'
import { discoverPeriod } from '@/lib/discover'

export const metadata: Metadata = {
  title: 'How Discover works',
  description: 'The rules Discover ranks posts by, the same for everyone, and what it never uses.',
}

const points = (n: number) => (n === 1 ? '1 point' : `${n} points`)

/** A score worked out the way the API does, rounded for reading. */
function score(rules: DiscoverRules, total: number, hours: number) {
  const value = total / (hours + rules.ageOffsetHours) ** rules.gravity
  return value >= 0.1 ? value.toFixed(2) : value.toPrecision(2)
}

export default function DiscoverRulesPage() {
  return (
    <div className="page-stack">
      <header className="page-intro">
        <p className="page-eyebrow">How HeyNaija works</p>
        <h1 className="page-title">How Discover works</h1>
        <p className="page-description">
          Discover is the first feed on Home: recent posts ranked by a few plain rules, the same for everyone, with a line
          on each post saying why it is there. Latest and Following stay in time order, newest first.
        </p>
      </header>

      <section className="content-panel" aria-labelledby="discover-uses">
        <h2 id="discover-uses" className="section-title">What it uses</h2>
        <div className="mt-3 space-y-3 text-sm leading-relaxed text-muted">
          <p>
            Only what anyone can already see on HeyNaija: replies, quotes, reposts and how many likes a post has. To that
            it adds who you follow and which communities you joined.
          </p>
          <p>
            It never uses what you read or how long you look at a post, who liked something (that is not public here),
            how many followers anyone has, or payment. Nothing is recorded about what you read.
          </p>
        </div>
      </section>

      <Suspense fallback={<PostsSkeleton />}>
        <Rules />
      </Suspense>
    </div>
  )
}

/** The rules, in words, with the numbers the API applies (ADR 0014). */
async function Rules() {
  const rules = await getDiscoverRules()
  const period = discoverPeriod(rules.windowHours)
  const example = rules.startingPoints + 3 * rules.conversationPoints + 4 * rules.likePoints
  const ownPosts = rules.ownPostsMinutes === 60 ? 'hour' : `${rules.ownPostsMinutes} minutes`
  const refresh = rules.visitorRefreshSeconds === 60 ? 'once a minute' : `every ${rules.visitorRefreshSeconds} seconds`

  return (
    <>
      <section id="rules" className="content-panel" aria-labelledby="discover-rules">
        <h2 id="discover-rules" className="section-title">How posts are ranked</h2>
        <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm leading-relaxed text-muted">
          <li>
            Discover looks at posts from the last {period}. Replies are not listed on their own; they count toward the post
            they are under. Posts by people you blocked or muted are left out.
          </li>
          <li>
            Every post starts with {points(rules.startingPoints)}, so a new post can be seen before anyone has replied to
            it or liked it.
          </li>
          <li>
            A post gets {points(rules.conversationPoints)} for each person, other than its author, who replied anywhere in
            its conversation or quoted it. Replying many times still counts as one person.
          </li>
          <li>
            It gets {points(rules.likePoints)} for each like and {points(rules.repostPoints)} for each repost.
          </li>
          <li>
            It gets {rules.followedPoints} more {rules.followedPoints === 1 ? 'point' : 'points'} for each person you
            follow who replied, quoted or reposted it,{' '}
            {points(rules.followsAuthorPoints)} if you follow its author, and {points(rules.joinedCommunityPoints)} if it is
            in a community you joined.
          </li>
          <li>
            A post loses ground as it ages: its score is its points divided by (hours since it was posted +{' '}
            {rules.ageOffsetHours}) to the power {rules.gravity}. A post from 2 hours ago that 3 people replied to and 4
            liked has {example} points and scores {score(rules, example, 2)}. The same post a day later scores{' '}
            {score(rules, example, 26)}.
          </li>
          <li>
            One person cannot fill Discover: each author&apos;s second post scores {rules.authorDecay === 0.5 ? 'half' : `${rules.authorDecay} times`}{' '}
            as much, their third {rules.authorDecay === 0.5 ? 'a quarter' : `${rules.authorDecay ** 2} times`}, and so on.
          </li>
          <li>
            A post that {rules.reportsToHold} or more members have reported, or that our check for child abuse images
            flagged, waits out of Discover until a moderator decides. It stays in Latest and everywhere else.
          </li>
          <li>Discover ends after {rules.maxPosts} posts. Latest has everything, newest first.</li>
          <li>
            Your own posts are not ranked. Those from the last {ownPosts} are shown above everything else, newest first, so
            you see what you just posted.
          </li>
          <li>
            Discover is ranked as of the moment you open it, so nothing moves while you read. Open it again to see it
            afresh.
          </li>
          <li>
            If you are not signed in, only the points that are the same for everyone count, and the ranking is worked out{' '}
            {refresh} for every visitor.
          </li>
          <li>
            Home opens on Discover. If you choose another tab, Home opens on that one next time; the choice is kept in your
            browser.
          </li>
        </ol>
      </section>

      <section className="content-panel" aria-labelledby="discover-why">
        <h2 id="discover-why" className="section-title">Why each post is there</h2>
        <p className="mt-3 text-sm leading-relaxed text-muted">Each post in Discover says the first of these that is true:</p>
        <ul className="mt-2 list-disc space-y-2 pl-5 text-sm leading-relaxed text-muted">
          <li>You posted it in the last {ownPosts}: &ldquo;Your post&rdquo;.</li>
          <li>Someone you follow replied, quoted it or reposted it: &ldquo;@ade replied&rdquo;.</li>
          <li>You follow its author: &ldquo;You follow @ade&rdquo;.</li>
          <li>It is in a community you joined: &ldquo;From Lagos, which you joined&rdquo;.</li>
          <li>People are taking part in it: &ldquo;Active on HeyNaija&rdquo;.</li>
          <li>Otherwise it is new, and has only its starting point: &ldquo;New on HeyNaija&rdquo;.</li>
        </ul>
        <p className="mt-4 text-sm">
          <Link href="/?feed=discover" className="font-semibold text-accent-strong hover:underline">Open Discover</Link>
          <span className="text-muted"> · </span>
          <Link href="/about" className="font-semibold text-accent-strong hover:underline">About HeyNaija</Link>
        </p>
      </section>
    </>
  )
}
