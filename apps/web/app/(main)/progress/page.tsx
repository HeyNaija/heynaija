import type { Metadata } from 'next'
import Link from 'next/link'
import { FeedbackNotice } from '@/app/ui/governance'
import { defaultPreviewImage, siteOpenGraph } from '@/lib/previews'
import { AVAILABILITY, CATEGORIES, PRIORITIES, ROADMAP, STATUSES, roadmapGroups, statusCounts, type FeatureStatus } from '@/lib/roadmap'

const description = 'What works in HeyNaija, what still needs work, and what comes next. A factual product roadmap, separate from formal governance decisions.'

export const metadata: Metadata = {
  title: 'Progress',
  description,
  openGraph: { ...siteOpenGraph, type: 'website', title: 'Building HeyNaija in the open', description, images: [defaultPreviewImage] },
}

export default function ProgressPage() {
  const counts = statusCounts(ROADMAP.features)
  return (
    <article className="page-stack progress-page">
      <header className="content-panel about-intro">
        <p className="page-eyebrow">Our product roadmap</p>
        <h1 className="page-title editorial-title">Building HeyNaija in the open</h1>
        <p className="about-lead">
          A clear view of what works, what needs more work, and what we’re considering next.
          This tracks product development, not formal governance decisions.
        </p>
        <nav aria-label="More about HeyNaija" className="policy-links">
          <Link href="/about">Why HeyNaija exists</Link>
          <Link href="/governance">Governance</Link>
          <Link href="/ideas">Suggest an idea or report a problem</Link>
        </nav>
      </header>

      <section className="content-panel" aria-labelledby="progress-statuses">
        <h2 id="progress-statuses" className="about-heading">How to read this roadmap</h2>
        <p className="about-copy">
          Priority is importance, not completion. A P0 gap stays a priority even when later ideas are easier
          to build. These counts describe the feature inventory; they are not a measure of product quality
          or readiness to launch.
        </p>
        <dl className="progress-definitions">
          {(Object.keys(STATUSES) as FeatureStatus[]).map((status) => (
            <div key={status}>
              <dt><strong>{counts[status]}</strong> {STATUSES[status].label}</dt>
              <dd>{STATUSES[status].definition}</dd>
            </div>
          ))}
        </dl>
        <div className="progress-availability" role="note">
          <p><strong>Implementation and availability are different.</strong></p>
          <p>
            This inventory checks the local staging code and tests. Live availability has not been
            verified for most features. Staging is an invite-only test environment; “recorded on staging”
            does not confirm this revision is deployed or guarantee general availability. Production is
            deployed; “recorded in production” means a feature was confirmed working there, not that every
            feature is.
          </p>
        </div>
      </section>

      <nav aria-label="Roadmap priorities" className="progress-priorities">
        {Object.entries(PRIORITIES).map(([priority, label]) => (
          <a key={priority} href={`#${priority.toLowerCase()}`}><strong>{priority}</strong><span>{label}</span></a>
        ))}
      </nav>

      {roadmapGroups(ROADMAP.features).map(({ priority, categories }) => (
        <section key={priority} id={priority.toLowerCase()} className="progress-priority" aria-labelledby={`${priority}-heading`}>
          <header className="progress-priority-heading">
            <p className="page-eyebrow">{priority}</p>
            <h2 id={`${priority}-heading`} className="about-heading">{PRIORITIES[priority]}</h2>
          </header>
          {categories.map(({ category, features }) => (
            <section key={category} className="content-panel progress-category" aria-labelledby={`${priority}-${category}`}>
              <h3 id={`${priority}-${category}`} className="section-title">{CATEGORIES[category]}</h3>
              <ul className="progress-features">
                {features.map((feature) => (
                  <li key={feature.id} id={feature.id}>
                    <div className="progress-feature-heading">
                      <h4>{feature.name}</h4>
                      <span className={`status-chip progress-status is-${feature.status}`}>{STATUSES[feature.status].label}</span>
                    </div>
                    <p className="progress-description">{feature.description}</p>
                    {feature.caveat ? <p className="progress-caveat">{feature.caveat}</p> : null}
                    <p className="progress-feature-meta"><span>{priority}</span><span>{AVAILABILITY[feature.availability]}</span></p>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </section>
      ))}

      <footer className="content-panel">
        <h2 className="about-heading">An honest work in progress</h2>
        <p className="about-copy">
          Priorities can change as we learn from members. There are no promised delivery dates here.
          Tests support the implementation record; they do not guarantee production readiness.
          This readable roadmap and the{' '}
          <a href="https://github.com/HeyNaija/heynaija/blob/main/docs/FEATURE_ROADMAP.md">developer version</a>{' '}
          are generated from the same feature registry, in HeyNaija’s public source code.
        </p>
        <FeedbackNotice />
        <nav aria-label="Keep exploring" className="policy-links">
          <Link href="/about">About HeyNaija</Link>
          <Link href="/governance">How governance would work</Link>
          <Link href="/charter">Founding charter</Link>
          <Link href="/licence">Licence and source code</Link>
        </nav>
      </footer>
    </article>
  )
}
