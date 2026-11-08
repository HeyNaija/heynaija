import type { Metadata } from 'next'
import Link from 'next/link'
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
      updated="8 November 2026"
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
                profile photos included, is compared with lists of known child sexual abuse material kept by child
                protection organisations, before anyone else can see it. A match is never published. If the check
                cannot be done, the upload waits: nothing is published unchecked.
              </li>
              <li>
                <strong>Checked again as it is served.</strong> Pictures are also checked by Cloudflare’s CSAM Scanning
                Tool as they are delivered.
              </li>
              <li>
                <strong>Reports from people.</strong> Anyone can report a post or an account, and moderators look at
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
            <ul>
              <li>
                <strong>On HeyNaija:</strong> open the menu on the post or account, choose <strong>Report</strong>, then{' '}
                <strong>Illegal content</strong>. This works the same in the apps and on the website. Reports of illegal
                content alert the people who handle safety straight away, and only moderators see who made a report.
              </li>
              <li>
                <strong>Not a member, or reporting for an authority?</strong> Write to <ContactEmail /> with a link to
                the post or account. Never send the picture or video itself, and never send any image of a child: the
                link is enough for us to find it.
              </li>
              <li>
                <strong>If a child is in danger now,</strong> call the police first. In Nigeria, call 112.
              </li>
              <li>
                You can also report child sexual abuse material found anywhere online to the{' '}
                <a href="https://report.cybertip.org/">NCMEC CyberTipline</a> or the{' '}
                <a href="https://report.iwf.org.uk/">Internet Watch Foundation</a>.
              </li>
            </ul>
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
