import type { Metadata } from 'next'
import Link from 'next/link'
import { DotsIcon, FlagIcon } from '@/app/ui/icons'
import { ContactEmail, PolicyPage } from '@/app/ui/policy-page'

export const metadata: Metadata = {
  title: 'Child safety standards',
  description: 'HeyNaija does not allow child sexual abuse and exploitation. How we find it, remove it and report it, and how to reach us.',
}

/**
 * HeyNaija's published standards against child sexual abuse and exploitation (CSAE),
 * which Google Play asks social apps to link to. What it says about scanning follows
 * docs/safety/abuse-material-scanning.md and docs/safety/video-scanning.md: keep them in step.
 */
export default function ChildSafetyPage() {
  return (
    <PolicyPage
      eyebrow="Keeping children safe"
      title="Child safety standards"
      summary="HeyNaija does not allow child sexual abuse and exploitation (CSAE) of any kind. This page sets out what is not allowed, how we find it and what we do about it, how to report it, and who to contact."
      updated="20 November 2026"
      draft={false}
      sections={[
        {
          id: 'standards',
          title: 'Our standards',
          body: (
            <>
              <p>
                HeyNaija has <strong>zero tolerance</strong> for child sexual abuse and exploitation. These standards
                apply everywhere on HeyNaija: on the website and in the HeyNaija apps for Android and iPhone, in posts,
                replies, pictures, GIFs, videos, profiles, communities and Gists. A child is anyone under 18.
              </p>
              <p>Never allowed, in any form:</p>
              <ul>
                <li>
                  <strong>Child sexual abuse material (CSAM):</strong> any picture, video or other depiction of a child
                  in a sexual way, whether real, drawn or made by a computer, AI included.
                </li>
                <li>
                  <strong>Sexualising children:</strong> sexual comments about a child, or content that presents
                  children as sexual.
                </li>
                <li>
                  <strong>Grooming:</strong> contacting a child, or someone you believe is a child, to build trust for a
                  sexual purpose, to ask for sexual pictures, or to arrange to meet.
                </li>
                <li>
                  <strong>Sextortion:</strong> threatening to share sexual pictures of a child, or using threats to get
                  them.
                </li>
                <li>
                  <strong>Trafficking:</strong> offering, selling or seeking a child for any sexual purpose.
                </li>
                <li>Asking for, offering or linking to any of the above.</li>
              </ul>
              <p>
                There are no exceptions: not as a joke, not to “raise awareness”, and not in a post marked sensitive.
                These standards sit alongside the <Link href="/rules">HeyNaija rules</Link>, which apply to everyone.
              </p>
            </>
          ),
        },
        {
          id: 'adults',
          title: 'HeyNaija is for adults during the beta',
          body: (
            <p>
              During the beta, accounts are for people aged 18 or older, and everyone confirms they are when they join.
              If moderators have good reason to believe an account belongs to someone under 18, they may suspend it.
              The <Link href="/rules#age">rules</Link> explain this, and what would have to be in place before younger
              people could join.
            </p>
          ),
        },
        {
          id: 'detection',
          title: 'How we find it',
          body: (
            <ul>
              <li>
                <strong>Checked before it is published.</strong> Every picture, GIF and video uploaded to HeyNaija,
                profile photos included, is compared with known child sexual abuse material before anyone else can
                see it, using <a href="https://shield.projectarachnid.com/">Arachnid Shield</a> from the Canadian
                Centre for Child Protection. A match is never published. If the check cannot be done, the upload
                waits: nothing is published unchecked.
              </li>
              <li>
                <strong>Checked again as it is served.</strong> Pictures are also checked by Cloudflare’s CSAM Scanning
                Tool as they are delivered.
              </li>
              <li>
                <strong>Reports from people.</strong> Anyone can report a post, an account or a Gist. They can also
                report a safety concern from Settings. Both work without leaving the app. The safety team looks at
                every report.
              </li>
            </ul>
          ),
        },
        {
          id: 'action',
          title: 'What we do',
          body: (
            <>
              <p>When we find child sexual abuse or exploitation, or are told about it, we:</p>
              <ul>
                <li>remove it at once, and suspend the account without warning;</li>
                <li>
                  keep a copy privately, out of public view and open only to the people who handle safety, as evidence;
                </li>
                <li>report it to the authorities responsible, as the law requires;</li>
                <li>work with law enforcement investigating it, and answer their lawful requests.</li>
              </ul>
              <p>
                HeyNaija follows the child safety laws that apply to it, including Nigeria’s Cybercrimes (Prohibition,
                Prevention, etc.) Act 2015 and Child Rights Act 2003.
              </p>
            </>
          ),
        },
        {
          id: 'report',
          title: 'How to report it',
          body: (
            <>
              <p>
                You can report from the HeyNaija app or the website. It works the same way in both, and you never have to
                leave the app.
              </p>

              <h3>To report a post</h3>
              <ol>
                <li>
                  Tap <MenuDots /> on the post.
                </li>
                <li>
                  Choose <strong>Report post</strong>.
                </li>
                <li>
                  Choose <strong>Child sexual abuse or exploitation</strong>, then send.
                </li>
              </ol>

              <h3>To report an account</h3>
              <ol>
                <li>Open their profile.</li>
                <li>
                  Tap <MenuDots /> at the top.
                </li>
                <li>
                  Choose <strong>Report</strong>.
                </li>
                <li>
                  Choose <strong>Child sexual abuse or exploitation</strong>, then send.
                </li>
              </ol>

              <h3>To report a Gist</h3>
              <ol>
                <li>
                  In the Gist, tap the <GistFlag /> button.
                </li>
                <li>
                  Choose <strong>Child sexual abuse or exploitation</strong>, then send.
                </li>
              </ol>

              <h3>To report anything else</h3>
              <p>Use this for something you saw, or something that happened to you or someone you know.</p>
              <ol>
                <li>
                  Go to <strong>Settings</strong>.
                </li>
                <li>
                  Choose <strong>Report a safety concern</strong>.
                </li>
                <li>Say what happened and where. Add links to any posts or accounts involved.</li>
              </ol>

              <h3>What happens next</h3>
              <p>
                Reports of child sexual abuse or exploitation reach the safety team straight away. Only moderators see
                who made the report. The person you report is never told.
              </p>

              <h3>Not a member?</h3>
              <p>
                Write to <ContactEmail />. Send a link to the post or account. Do not send the picture or video itself.
                Never send any image of a child. The link is enough for us to find it.
              </p>
              <p>Authorities can write to the same address.</p>

              <h3>If a child is in danger now</h3>
              <p>Call the police first. In Nigeria, call 112.</p>

              <h3>Abuse material anywhere else online</h3>
              <p>
                You can also report it to the <a href="https://report.cybertip.org/">NCMEC CyberTipline</a> or the{' '}
                <a href="https://report.iwf.org.uk/">Internet Watch Foundation</a>.
              </p>
            </>
          ),
        },
        {
          id: 'contact',
          title: 'Child safety contact',
          body: (
            <p>
              HeyNaija’s founders are responsible for child safety. Write to <ContactEmail /> about these standards or
              how we apply them, including from an app store, a regulator or law enforcement. It is the same address
              that receives our alerts about illegal content.
            </p>
          ),
        },
      ]}
    />
  )
}

/** The ⋯ menu button, drawn as the app and the website draw it; screen readers hear its name instead. */
function MenuDots() {
  return (
    <span className="inline-flex align-[-0.25em] font-semibold text-ink">
      <DotsIcon size={20} />
      <span className="sr-only">the three dots button</span>
    </span>
  )
}

/** The flag that reports a Gist, as the app and the website draw it. */
function GistFlag() {
  return (
    <span className="inline-flex items-center gap-1 align-[-0.2em] font-semibold text-ink">
      <FlagIcon size={17} />
      flag
    </span>
  )
}
