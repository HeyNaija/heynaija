import type { Metadata } from 'next'
import Form from 'next/form'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { Suspense } from 'react'
import { finishOnboarding, skipOnboarding } from '@/app/actions'
import { Avatar } from '@/app/ui/avatar'
import { CommunityMark } from '@/app/ui/community-mark'
import { EmptyState } from '@/app/ui/empty-state'
import { PeopleIcon } from '@/app/ui/icons'
import { SubmitButton } from '@/app/ui/submit-button'
import { type Community, getCommunities, getOnboardingSuggestions, getViewer, type Suggestion } from '@/lib/api'
import { listOf, welcomePath } from '@/lib/onboarding'

export const metadata: Metadata = { title: 'Welcome' }

// A newcomer is sent here from the home page until they finish or skip (see
// members.onboarded_at). Step 1 picks communities and carries them in the URL;
// step 2 picks people, and its form joins and follows everything at once;
// step 3 is the home page's nudge to post. Every form is a plain form, so the
// flow works before JavaScript has loaded.
export default function WelcomePage({ searchParams }: PageProps<'/welcome'>) {
  return (
    <div className="page-stack">
      <Suspense fallback={<div aria-busy="true" className="skeleton h-96" />}>
        <Welcome searchParams={searchParams} />
      </Suspense>
    </div>
  )
}

const all = (value: string | string[] | undefined) => (Array.isArray(value) ? value : value ? [value] : [])

const ERRORS: Record<string, string> = {
  busy: 'You are going a little fast. Wait a minute and try again.',
  failed: 'That did not go through. Check your connection and try again.',
}

async function Welcome({ searchParams }: Pick<PageProps<'/welcome'>, 'searchParams'>) {
  const [viewer, params, communities] = await Promise.all([getViewer(), searchParams, getCommunities()])
  if (viewer.state === 'anonymous') redirect('/login')
  if (viewer.state !== 'member') redirect('/')

  // Only communities that exist: the URL is the member's to edit.
  const asked = new Set(all(params.c))
  const chosen = communities.filter((c) => asked.has(c.slug) || c.viewerIsMember)
  const step = params.step === 'people' ? 'people' : 'communities'
  const error = ERRORS[all(params.error)[0] ?? '']

  return (
    <>
      <header className="page-intro">
        <div className="welcome-intro-top">
          <p className="page-eyebrow">Welcome to HeyNaija</p>
          <form action={skipOnboarding}>
            <SubmitButton className="welcome-skip">Skip setup</SubmitButton>
          </form>
        </div>
        <h1 className="page-title">
          {step === 'communities' ? 'Find your places' : 'Find your people'}
          <span className="text-accent">.</span>
        </h1>
        <p className="page-description">
          {step === 'communities'
            ? 'Join a few communities to fill your Following feed with conversations you care about. It takes a minute, and you can change everything later.'
            : 'Follow a few people and their posts and reposts will show up in your Following feed.'}
        </p>
        <Steps current={step} />
      </header>
      {error ? <p role="alert" className="notice notice-danger">{error}</p> : null}
      {step === 'communities' ? (
        <CommunitiesStep communities={communities} chosen={chosen} />
      ) : (
        <Suspense fallback={<div aria-busy="true" className="skeleton h-96" />}>
          <PeopleStep chosen={chosen} />
        </Suspense>
      )}
    </>
  )
}

const STEPS = [
  { key: 'communities', label: 'Communities' },
  { key: 'people', label: 'People' },
  { key: 'post', label: 'Say hello' },
] as const

function Steps({ current }: { current: 'communities' | 'people' }) {
  const at = STEPS.findIndex((s) => s.key === current)
  return (
    <ol className="welcome-steps" aria-label="Setup steps">
      {STEPS.map((s, i) => (
        <li key={s.key} aria-current={i === at ? 'step' : undefined} className={i < at ? 'is-done' : undefined}>
          <span aria-hidden="true">{i + 1}</span>
          {s.label}
          {i < at ? <span className="sr-only"> (done)</span> : null}
        </li>
      ))}
    </ol>
  )
}

/** Step 1: tick communities. A GET form, so the choice travels to step 2 in the URL. */
function CommunitiesStep({ communities, chosen }: { communities: Community[]; chosen: Community[] }) {
  const ticked = new Set(chosen.map((c) => c.slug))
  return (
    <Form action="/welcome" className="content-panel settings-section">
      <input type="hidden" name="step" value="people" />
      <fieldset>
        <legend className="section-title">Choose communities</legend>
        <p className="field-hint mt-1">
          Posts in the communities you join show in your Following feed, and you can post in them too.
        </p>
        {communities.length ? (
          <ul className="welcome-choices mt-2">
            {communities.map((c) => (
              <li key={c.slug}>
                <label className="welcome-choice">
                  {c.viewerIsMember ? (
                    <>
                      {/* Already joined: it stays joined, and still shapes the suggestions. */}
                      <input type="checkbox" defaultChecked disabled aria-label={`Joined ${c.name}`} aria-describedby={`welcome-c-${c.slug}`} />
                      <input type="hidden" name="c" value={c.slug} />
                    </>
                  ) : (
                    <input type="checkbox" name="c" value={c.slug} defaultChecked={ticked.has(c.slug)} aria-label={`Join ${c.name}`} aria-describedby={`welcome-c-${c.slug}`} />
                  )}
                  <CommunityMark slug={c.slug} />
                  <span className="welcome-choice-text">
                    <strong>{c.name}</strong>
                    <span id={`welcome-c-${c.slug}`} className="welcome-choice-about">
                      <span className="welcome-choice-meta">
                        {c.memberCount.toLocaleString('en-NG')} {c.memberCount === 1 ? 'member' : 'members'}
                        {c.viewerIsMember ? ' · Joined' : ''}
                      </span>
                      <span className="welcome-choice-detail">{c.description}</span>
                    </span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState icon={<PeopleIcon size={24} />} title="Communities are on their way">
            Carry on, and you can join one when they open.
          </EmptyState>
        )}
      </fieldset>
      <div className="welcome-actions">
        <button type="submit" className="btn btn-primary">Continue</button>
        <Link href={welcomePath('people', [])} className="btn btn-ghost">Skip this step</Link>
      </div>
    </Form>
  )
}

const reasonText = ({ reason }: Suggestion) =>
  reason.kind === 'moderator'
    ? `Moderates ${reason.community.name}`
    : reason.kind === 'community'
      ? `Posts in ${reason.community.name}`
      : 'Posting on HeyNaija lately'

/** Step 2: tick people. Its form joins the step-1 communities and follows everyone ticked, at once. */
async function PeopleStep({ chosen }: { chosen: Community[] }) {
  const people = await getOnboardingSuggestions(chosen.map((c) => c.slug))
  const joining = chosen.filter((c) => !c.viewerIsMember)

  return (
    <form action={finishOnboarding} className="content-panel settings-section">
      {joining.map((c) => (
        <input key={c.slug} type="hidden" name="community" value={c.slug} />
      ))}
      <fieldset>
        <legend className="section-title">People to follow</legend>
        <p className="field-hint mt-1">
          {chosen.length
            ? `People who host and post in ${listOf(chosen.map((c) => c.name))}, and others who have been posting lately.`
            : 'People who have been posting on HeyNaija lately.'}
        </p>
        {people.length ? (
          <ul className="welcome-choices mt-2">
            {people.map((p) => (
              <li key={p.handle}>
                <label className="welcome-choice">
                  <input
                    type="checkbox"
                    name="follow"
                    value={p.handle}
                    aria-label={`Follow ${p.displayName ? `${p.displayName} ` : ''}@${p.handle}`}
                    aria-describedby={`welcome-p-${p.handle}`}
                  />
                  <Avatar handle={p.handle} src={p.avatar} size={40} />
                  <span className="welcome-choice-text">
                    <strong>{p.displayName ?? `@${p.handle}`}</strong>
                    <span id={`welcome-p-${p.handle}`} className="welcome-choice-about">
                      <span className="welcome-choice-meta">
                        {p.displayName ? `@${p.handle} · ` : ''}
                        {reasonText(p)}
                      </span>
                      {p.bio ? <span className="welcome-choice-detail line-clamp-2">{p.bio}</span> : null}
                    </span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState icon={<PeopleIcon size={24} />} title="No one to suggest yet">
            The town square is just getting started. Finish, and follow people as you meet them.
          </EmptyState>
        )}
      </fieldset>
      {joining.length ? (
        <p className="field-hint">
          Finishing also joins {listOf(joining.map((c) => c.name))}.
        </p>
      ) : null}
      <div className="welcome-actions">
        <SubmitButton className="btn btn-primary">Finish</SubmitButton>
        <SubmitButton name="people" value="skip" className="btn btn-ghost">Skip this step</SubmitButton>
        <Link href={welcomePath('communities', joining.map((c) => c.slug))} className="welcome-back">Back</Link>
      </div>
    </form>
  )
}
