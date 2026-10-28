import type { Metadata } from 'next'
import Link from 'next/link'
import { FoundingStageNotice } from '@/app/ui/governance'
import { ArrowUpRightIcon, DocumentIcon, HistoryIcon, OwnershipIcon, PeopleIcon, ShieldIcon } from '@/app/ui/icons'
import { PolicyLinks } from '@/app/ui/policy-page'
import { defaultPreviewImage, siteOpenGraph } from '@/lib/previews'

const description = 'Why HeyNaija exists: a Nigeria-first discussion network, built around our conversations and a proposed path for members to shape its future.'

export const metadata: Metadata = {
  title: 'About',
  description,
  openGraph: { ...siteOpenGraph, type: 'website', title: 'About HeyNaija', description, images: [defaultPreviewImage] },
}

const principles = [
  {
    Icon: PeopleIcon,
    title: 'Nigeria first, with room for the diaspora',
    detail: <>Our cities, campuses, work, culture and everyday experiences lead the conversation. Whether you’re in Nigeria or building a life elsewhere, there’s room to stay connected. Start with communities such as Lagos, Abuja, Tech &amp; Careers, Universities and Entertainment.</>,
  },
  {
    Icon: OwnershipIcon,
    title: 'A meaningful say in the future',
    detail: <>The people who bring a network to life should have a stake in how it is run. Community ownership is the destination. Today, the founding team runs HeyNaija; the <Link href="/charter">founding charter</Link> describes its commitments, and a draft constitution proposes a route to member-led governance.</>,
  },
  {
    Icon: DocumentIcon,
    title: 'Development you can follow',
    detail: <>We want to be clear about what works and what is missing. Our <Link href="/progress">public roadmap</Link> records both. The project has an AGPL licence and aims to publish its source, but the repository is still private. The <Link href="/licence">licence page</Link> explains that distinction.</>,
  },
  {
    Icon: ShieldIcon,
    title: 'Choice and accountability',
    detail: <>Follow people and join communities to shape your feed. Mute or block accounts, report harm, and appeal an account suspension. Moderators keep a decision log and send outcomes to affected members; that log is restricted to moderators. You can download your own data from Settings.</>,
  },
  {
    Icon: HistoryIcon,
    title: 'Designed for real access',
    detail: <>HeyNaija is built for the web, with phone layouts and image resizing that take data costs seriously. Making it work well on slower connections is an ongoing responsibility. We track the remaining performance and accessibility work on the roadmap, without claiming results we haven’t measured.</>,
  },
]

export default function AboutPage() {
  return (
    <article className="page-stack about-page">
      <header className="content-panel about-intro">
        <p className="page-eyebrow">About HeyNaija</p>
        <h1 className="page-title editorial-title">A place for our conversations. A say in what comes next.</h1>
        <p className="about-lead">
          HeyNaija is a Nigeria-first public discussion network for Nigerians at home and around the world.
          Share an idea, ask a question, find your community, and feel a little closer to home.
        </p>
        <div className="about-actions">
          <Link href="/" className="btn btn-primary">Explore conversations <ArrowUpRightIcon size={17} /></Link>
          <Link href="/progress" className="btn btn-secondary">See what we’re building</Link>
        </div>
      </header>

      <section className="content-panel" aria-labelledby="about-origin">
        <p className="page-eyebrow">The idea behind HeyNaija</p>
        <h2 id="about-origin" className="about-heading">We already have plenty to say.</h2>
        <div className="about-copy">
          <p>
            Nigerians are already in lively conversation: on X, in WhatsApp groups, on forums, and
            wherever people gather online. The question behind HeyNaija isn’t whether we need another
            place to talk. It’s what a place designed around our own communities, interests and
            everyday experiences could make possible.
          </p>
          <p>
            A question about starting a career. News from your city. A campus debate. A song you
            want everyone to hear. These conversations connect us across distance, and the people
            having them are what make a social network worth returning to.
          </p>
          <blockquote className="about-question">
            What if the people who make a social network valuable also had a say in how it is run?
          </blockquote>
          <p>
            That is the motivation for HeyNaija: a dedicated place for our conversations, with a
            meaningful path for members to shape the platform itself.
          </p>
        </div>
      </section>

      <section className="content-panel" aria-labelledby="about-principles">
        <h2 id="about-principles" className="about-heading">What we’re building around</h2>
        <ul className="about-features">
          {principles.map(({ Icon, title, detail }) => (
            <li key={title}>
              <span className="community-mark"><Icon size={20} /></span>
              <div>
                <h3 className="section-title">{title}</h3>
                <p>{detail}</p>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section className="content-panel" aria-labelledby="about-today">
        <h2 id="about-today" className="about-heading">A public square, with personal choices.</h2>
        <div className="about-copy">
          <p>
            You can post short text and photos, reply in a thread, like, repost, quote, and follow
            people or join communities. Home opens on <Link href="/about/discover">Discover</Link>, which
            ranks the last few days&apos; posts by rules published on its own page, from replies, quotes,
            reposts and like counts, who you follow and the communities you joined, and says why each
            post is there. Latest and Following are chronological: newest entries first, with
            explanations of why Following entries appear, and Home remembers the tab you chose. Under a post, its author&apos;s own
            replies come first, then everyone else&apos;s, newest first, or oldest first if you
            choose. Basic trending highlights recent
            active conversations, and <Link href="/topics">trending topics</Link> are the hashtags most
            members are using, by rules published on that page. None of them guesses what you will
            engage with.
          </p>
          <p>
            <strong>Every post and reply is public, including posts in communities.</strong> Your
            email, bookmarks, notifications, and block and mute choices stay private. Read the{' '}
            <Link href="/privacy">privacy policy</Link> and <Link href="/rules">community rules</Link>{' '}
            before joining in.
          </p>
        </div>
      </section>

      <section className="content-panel" aria-labelledby="about-ownership">
        <p className="page-eyebrow">A destination, with work still to do</p>
        <h2 id="about-ownership" className="about-heading">Community ownership has to be real.</h2>
        <div className="about-copy">
          <p>
            Having a say should mean more than being asked for feedback. The draft constitution
            proposes nonprofit Incorporated Trustees with three founding trustees serving initial three-year terms,
            two annually elected representatives from readiness, and all three trustee seats open to election at
            founding-term expiry. Legal membership and voluntary online voting are separate, and essential assets
            require lawful transfer to the nonprofit. Those steps need consultation, legal review, secure
            systems and published evidence. They have not happened simply because a draft exists.
          </p>
        </div>
        <FoundingStageNotice />
        <p className="about-copy">
          The <Link href="/governance">governance pages</Link> explain what is proposed and where it
          stands. Governance concerns the running of HeyNaija; it does not direct people’s personal
          opinions or turn disagreement into a public vote on someone’s account.
        </p>
      </section>

      <section className="content-panel" aria-labelledby="about-boundaries">
        <h2 id="about-boundaries" className="about-heading">People, conversation and clear boundaries.</h2>
        <div className="about-copy">
          <p>
            HeyNaija isn’t government-run or a verified-news authority. Hosting a post does not
            endorse it. You don’t have to leave every other social app to find something useful here,
            and nobody should have to agree with a particular opinion to belong. Participation
            comes with the responsibility to follow the published rules and respect other people.
          </p>
          <p>
            You don’t need a NIN to use HeyNaija. Optional NIN verification is planned and unavailable
            for now. It would be separate from ordinary signup and would check identity, not the
            truth of someone’s posts. Formal voting would need a separate, approved and secure
            process for checking eligibility.
          </p>
        </div>
      </section>

      <section className="content-panel about-welcome" aria-labelledby="about-join">
        <h2 id="about-join" className="about-heading">Start with a conversation.</h2>
        <div className="about-copy">
          <p>Read the public feed and explore communities without an account. To post and take part in the beta, you’ll need an invite.</p>
          <p>
            The beta currently asks new members to declare that they are 18 or older. This is a
            temporary signup restriction, not a permanent adults-only policy or proof of verified
            adulthood. Sign-in uses an emailed code or, where configured, Google.
          </p>
        </div>
        <div className="about-actions">
          <Link href="/join" className="btn btn-primary">Join with an invite <ArrowUpRightIcon size={17} /></Link>
          <Link href="/c" className="btn btn-secondary">Find your community</Link>
        </div>
        <p className="about-copy"><Link href="/progress">See what we’re building</Link> · <Link href="/governance">How governance would work</Link></p>
      </section>

      <footer className="policy-footer">
        <p>Get to know the details</p>
        <PolicyLinks />
      </footer>
    </article>
  )
}
