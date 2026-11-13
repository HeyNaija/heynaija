import type { Metadata } from 'next'
import Link from 'next/link'
import { Suspense } from 'react'
import { PostsSkeleton } from '@/app/ui/post-item'
import { getHighlightsRules } from '@/lib/api'
import { daysInWords, highlightsTime } from '@/lib/highlights'

export const metadata: Metadata = {
  title: 'How weekly highlights work',
  description: 'When HeyNaija sends you conversations you missed, the rules they are chosen by, and how to turn them off.',
}

const points = (n: number) => (n === 1 ? '1 point' : `${n} points`)

export default function HighlightsRulesPage() {
  return (
    <div className="page-stack">
      <header className="page-intro">
        <p className="page-eyebrow">How HeyNaija works</p>
        <h1 className="page-title">How weekly highlights work</h1>
        <p className="page-description">
          If you have not opened HeyNaija for a few days, we send you a few conversations you missed, at most once a week.
          They are chosen by a few plain rules, the same for everyone, and each one says why it was chosen.
        </p>
      </header>

      <section className="content-panel" aria-labelledby="highlights-uses">
        <h2 id="highlights-uses" className="section-title">What it uses</h2>
        <div className="mt-3 space-y-3 text-sm leading-relaxed text-muted">
          <p>
            Only what anyone can already see on HeyNaija: replies, quotes, reposts and how many likes a post has. To that
            it adds who you follow, which communities you joined, and when you were last here.
          </p>
          <p>
            It never uses what you read or how long you look at a post, who liked something (that is not public here), or
            payment. The email has no pictures and nothing that tells us you opened it or what you tapped. We do keep when
            we last sent you highlights; with when you were last here, that tells us whether they are worth sending at
            all.
          </p>
        </div>
      </section>

      <Suspense fallback={<PostsSkeleton />}>
        <Rules />
      </Suspense>
    </div>
  )
}

/** The rules, in words, with the numbers the API applies (ADR 0027). */
async function Rules() {
  const rules = await getHighlightsRules()
  const away = daysInWords(rules.awayDays)
  const example = 3 * rules.conversationPoints + 4 * rules.likePoints

  return (
    <>
      {rules.live ? null : (
        <p role="status" className="notice">
          Weekly highlights are not being sent yet. This page says how they will work when they are.
        </p>
      )}

      <section id="when" className="content-panel" aria-labelledby="highlights-when">
        <h2 id="highlights-when" className="section-title">When they are sent</h2>
        <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm leading-relaxed text-muted">
          <li>Once a week, on {highlightsTime(rules.weekday, rules.hourUtc)}, Nigerian time.</li>
          <li>
            Only if you have not opened HeyNaija for {away}. If you were here more recently than that, you are sent
            nothing.
          </li>
          <li>
            Only if at least {rules.minPosts} conversations are worth sending. In a quiet week you are sent nothing.
          </li>
          <li>
            As a push notification, on a phone or browser where you turned those on. If you have none, as an email, if
            notification emails are on for you. Never both, and if you have neither on, nothing is sent.
          </li>
          <li>
            After {daysInWords(rules.stopAfterDays)} away we stop. Someone who has left is not chased.
          </li>
        </ol>
      </section>

      <section id="rules" className="content-panel" aria-labelledby="highlights-rules">
        <h2 id="highlights-rules" className="section-title">How conversations are chosen</h2>
        <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm leading-relaxed text-muted">
          <li>
            Only posts from the last {daysInWords(rules.windowDays)} that were written after you were last here, so
            nothing in it is something you have already seen. Replies are not listed on their own; they count toward the
            post they are under.
          </li>
          <li>
            A post is worth sending if someone other than its author replied to it, quoted it, liked it or reposted it,
            or if you follow its author.
          </li>
          <li>
            A post gets {points(rules.conversationPoints)} for each person, other than its author, who replied anywhere in
            its conversation or quoted it, {points(rules.likePoints)} for each like and {points(rules.repostPoints)} for
            each repost. A post that 3 people replied to and 4 liked has {example} points.
          </li>
          <li>
            It gets {rules.followedPoints} more {rules.followedPoints === 1 ? 'point' : 'points'} for each person you
            follow who replied, quoted or reposted it, {points(rules.followsAuthorPoints)} if you follow its author, and{' '}
            {points(rules.joinedCommunityPoints)} if it is in a community you joined. These are the points{' '}
            <Link href="/about/discover" className="font-semibold text-accent-strong hover:underline">Discover</Link> uses,
            without its ageing: this is the week, not this hour.
          </li>
          <li>
            The posts with the most points come first, newer ones first when they are level. Each author appears once,
            with their best post, and you are sent at most {rules.maxPosts}.
          </li>
          <li>
            Left out: your own posts, anyone you blocked or muted, posts that were deleted or taken down, posts marked
            sensitive, and a post that {rules.reportsToHold} or more members have reported, or that our check for child
            abuse images flagged, until a moderator decides.
          </li>
        </ol>
      </section>

      <section className="content-panel" aria-labelledby="highlights-why">
        <h2 id="highlights-why" className="section-title">Why each one is there</h2>
        <p className="mt-3 text-sm leading-relaxed text-muted">Each conversation says the first of these that is true:</p>
        <ul className="mt-2 list-disc space-y-2 pl-5 text-sm leading-relaxed text-muted">
          <li>Someone you follow replied, quoted it or reposted it: &ldquo;@ade, who you follow, replied&rdquo;.</li>
          <li>You follow its author: &ldquo;You follow @ade&rdquo;.</li>
          <li>It is in a community you joined: &ldquo;From Lagos, which you joined&rdquo;.</li>
          <li>Otherwise, people took part in it: &ldquo;Active on HeyNaija&rdquo;.</li>
        </ul>
      </section>

      <section id="off" className="content-panel" aria-labelledby="highlights-off">
        <h2 id="highlights-off" className="section-title">Turning them off</h2>
        <div className="mt-3 space-y-3 text-sm leading-relaxed text-muted">
          <p>
            Untick <strong>Send me weekly highlights</strong> in Settings, under Notifications. Every highlights email
            also has a link that turns them off with one click, without signing in. Either way, your notifications and
            whether they are emailed stay as they are.
          </p>
        </div>
        <p className="mt-4 text-sm">
          <Link href="/settings" className="font-semibold text-accent-strong hover:underline">Open Settings</Link>
          <span className="text-muted"> · </span>
          <Link href="/about/discover" className="font-semibold text-accent-strong hover:underline">How Discover works</Link>
          <span className="text-muted"> · </span>
          <Link href="/about" className="font-semibold text-accent-strong hover:underline">About HeyNaija</Link>
        </p>
      </section>
    </>
  )
}
