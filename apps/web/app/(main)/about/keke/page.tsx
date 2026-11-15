import type { Metadata } from 'next'
import Link from 'next/link'
import { Suspense } from 'react'
import { PostsSkeleton } from '@/app/ui/post-item'
import { getKekeAbout, type KekeAbout } from '@/lib/api'
import { kekeRoute, PAGE_NAMES } from '@/lib/keke'

export const metadata: Metadata = {
  title: 'Keke, the help bot',
  description: 'Mention @keke with a question about HeyNaija and it answers from HeyNaija’s own pages. What it reads, what is sent and to whom, and its limits.',
}

const link = 'font-semibold text-accent-strong hover:underline'

export default function KekePage() {
  return (
    <div className="page-stack">
      <header className="page-intro">
        <p className="page-eyebrow">How HeyNaija works</p>
        <h1 className="page-title">Keke, the help bot</h1>
        <p className="page-description">
          Keke answers questions about HeyNaija. Write @keke in a post or a reply with your question, and it answers in the
          thread, from HeyNaija&rsquo;s own pages and nothing else. It is an automated account, and it can be wrong.
        </p>
      </header>

      <section className="content-panel" aria-labelledby="keke-asking">
        <h2 id="keke-asking" className="section-title">Asking Keke</h2>
        <ul className="mt-3 list-disc space-y-2 pl-5 text-sm leading-relaxed text-muted">
          <li>Write @keke and your question in a post or a reply. Keke replies under it, usually within a minute. Its reply is public, like every post.</li>
          <li>It answers questions about HeyNaija itself: how it works, its rules, your privacy and what is being built.</li>
          <li>
            When the pages do not answer your question, it says so rather than guess. When the question is not about HeyNaija, it
            says that too. Both of those replies are words we wrote, not the model&rsquo;s.
          </li>
          <li>
            Every answer ends with a link to the page it came from. The page is what counts: where Keke and the page disagree, the
            page is right.
          </li>
          <li>Keke never names anyone in a reply and never links anywhere but HeyNaija.</li>
        </ul>
      </section>

      <Suspense fallback={<PostsSkeleton />}>
        <Details />
      </Suspense>
    </div>
  )
}

/** Who handles a question, from what this server is set up with (ADR 0030). */
function Route({ model }: { model: KekeAbout['models'][number] }) {
  return (
    <li>
      <strong>{model.name}</strong>, made by {model.maker}: a question {kekeRoute(model)}
    </li>
  )
}

async function Details() {
  const keke = await getKekeAbout()
  const first = keke.models.find((m) => m.family === keke.firstChoice)
  const other = keke.models.find((m) => m.family !== keke.firstChoice)

  return (
    <>
      {keke.live ? null : (
        <p role="status" className="notice">
          {keke.inUse
            ? 'Keke is answering a few members while it is tried out. This page says how it works.'
            : 'Keke is not answering yet. This page says how it will work when it is.'}
        </p>
      )}

      <section id="pages" className="content-panel" aria-labelledby="keke-pages">
        <h2 id="keke-pages" className="section-title">What it answers from</h2>
        <p className="mt-3 text-sm leading-relaxed text-muted">
          These pages, as anyone can read them without signing in, read again every hour. Nothing else: not other
          posts, not your profile, not the rest of the web.
        </p>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm leading-relaxed text-muted">
          {keke.pages.map((path) => (
            <li key={path}>
              <Link href={path} className={link}>{PAGE_NAMES[path] ?? path}</Link>
            </li>
          ))}
        </ul>
      </section>

      <section id="sent" className="content-panel" aria-labelledby="keke-sent">
        <h2 id="keke-sent" className="section-title">What is sent, and to whom</h2>
        <div className="mt-3 space-y-3 text-sm leading-relaxed text-muted">
          <p>
            Keke&rsquo;s answers are written by a language model run by another company. When you mention Keke, the text of
            your post is sent to it with the pages above, and, if your post is a reply, the text of the post it answers, so
            the question makes sense. Other members&rsquo; @handles in them are replaced with @someone. Your name, your
            handle, your email, your pictures and anything private are not sent.
          </p>
          {keke.models.length === 0 ? (
            <p>This server has no model set up, so Keke does not answer here and nothing is sent.</p>
          ) : (
            <>
              <ul className="list-disc space-y-2 pl-5">
                {keke.models.map((model) => (
                  <Route key={model.family} model={model} />
                ))}
              </ul>
              {first ? (
                <p>
                  {first.name} answers {keke.trial ? 'most questions' : 'every question'}
                  {other ? `; if it cannot, ${other.name} is asked once instead` : ''}.
                  {keke.trial && other
                    ? ` For now some members’ questions go to ${other.name} first, to compare the two on real questions.`
                    : ''}
                </p>
              ) : null}
            </>
          )}
          <p>
            Keke does not learn from questions: each one is answered on its own. What we keep about each is which model
            answered, how long the question and answer were (in tokens), what it cost and what kind of answer it was; not
            who asked or what. The <Link href="/privacy#processors" className={link}>privacy policy</Link> lists everyone
            who handles your data.
          </p>
        </div>
      </section>

      <section id="limits" className="content-panel" aria-labelledby="keke-limits">
        <h2 id="keke-limits" className="section-title">Limits</h2>
        <ul className="mt-3 list-disc space-y-2 pl-5 text-sm leading-relaxed text-muted">
          <li>
            Keke answers each member at most {keke.perHour} times an hour and {keke.perDay} times a day, and writes at most{' '}
            {keke.perConversation} replies in one conversation. Past that it says nothing.
          </li>
          <li>
            It does not reply where it may not: in a conversation whose author limited who may reply, or to someone who blocked
            it.
          </li>
          <li>An answer is at most {keke.answerMax} characters, plus the link to its page.</li>
          <li>We spend at most a fixed amount on Keke each month. If it is reached, Keke stops answering until the next month.</li>
        </ul>
      </section>

      <section id="reporting" className="content-panel" aria-labelledby="keke-reporting">
        <h2 id="keke-reporting" className="section-title">When it gets something wrong</h2>
        <p className="mt-3 text-sm leading-relaxed text-muted">
          Keke&rsquo;s replies are ordinary posts. Report one that is wrong or harmful as you would any post, and a moderator
          can remove it. If a page itself is unclear, say so on the ideas board.
        </p>
        <p className="mt-4 text-sm">
          <Link href="/ideas" className={link}>Ideas board</Link>
          <span className="text-muted"> · </span>
          <Link href="/about/discover" className={link}>How Discover works</Link>
          <span className="text-muted"> · </span>
          <Link href="/about" className={link}>About HeyNaija</Link>
        </p>
      </section>
    </>
  )
}
