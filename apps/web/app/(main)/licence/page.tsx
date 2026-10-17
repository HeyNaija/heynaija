import type { Metadata } from 'next'
import Link from 'next/link'
import { PolicyPage } from '@/app/ui/policy-page'

export const metadata: Metadata = { title: 'Licence' }

export default function LicencePage() {
  return (
    <PolicyPage
      eyebrow="Open source"
      title="Licence"
      summary="HeyNaija’s code is free software under the GNU Affero General Public License, version 3 or later (AGPL-3.0-or-later). This page explains what that means, and what it does not cover."
      updated="15 October 2026"
      sections={[
        {
          id: 'code',
          title: 'The code',
          body: (
            <>
              <p>Under the AGPL, anyone may use, study, change and share HeyNaija’s code. In return:</p>
              <ul>
                <li>Anyone who shares it, changed or not, must share it under the same licence.</li>
                <li>
                  Anyone who runs a changed version as a service for others must offer those users the
                  source code of their version. This is what keeps a closed copy of HeyNaija from being run
                  without giving its changes back.
                </li>
              </ul>
              <p>
                The full licence text is in the <code>LICENSE</code> file with the code, and at{' '}
                <a href="https://www.gnu.org/licenses/agpl-3.0.html">gnu.org/licenses/agpl-3.0.html</a>.
              </p>
            </>
          ),
        },
        {
          id: 'source',
          title: 'Where the source is',
          body: (
            <p>
              The source code is not public yet. It will be published at github.com/HeyNaija/heynaija, and
              this page will link to it when it is.
            </p>
          ),
        },
        {
          id: 'not-covered',
          title: 'What the licence does not cover',
          body: (
            <ul>
              <li>
                <strong>What members post.</strong> Your posts and images are yours, not covered by the code
                licence. Posts are public; see the <Link href="/privacy">privacy policy</Link>.
              </li>
              <li>
                <strong>The HeyNaija name and wordmark.</strong> A copy of the code is welcome, but it should
                not be presented as HeyNaija.
              </li>
            </ul>
          ),
        },
      ]}
    />
  )
}
