import type { Metadata } from 'next'
import { cookies } from 'next/headers'
import Link from 'next/link'
import { AuthPage, linkClass } from '@/app/ui/auth-page'
import { AuthForm } from '@/lib/auth/server'
import { AGE_COOKIE, INVITE_COOKIE, type InviteProblem, readDraft, SIGNUP_DRAFT_COOKIE } from '@/lib/invite'

export const metadata: Metadata = { title: 'Create your account' }

export default function SignupPage({ searchParams }: PageProps<'/signup'>) {
  return (
    <AuthPage
      eyebrow="You're invited"
      title="Create your account"
      intro="During the beta, HeyNaija is invite-only and open to people aged 18 or older. Choose your public handle: your email stays private, and a sign-in code takes the place of a password."
      footer={
        <>
          <p>
            Before you join, read the <Link href="/rules" className={linkClass}>rules</Link> and the{' '}
            <Link href="/privacy" className={linkClass}>privacy policy</Link>. Why 18+? See{' '}
            <Link href="/rules#age" className={linkClass}>the rules on age</Link>.
          </p>
          <p className="mt-2">
            Already a member?{' '}
            <Link href="/login" className={linkClass}>
              Sign in
            </Link>
          </p>
        </>
      }
    >
      <SignupForm searchParams={searchParams} />
    </AuthPage>
  )
}

const PROBLEMS: Record<InviteProblem, { field: 'code' | 'age'; text: string }> = {
  invalid: { field: 'code', text: 'That code is not valid. Check it, or ask whoever invited you for a new one.' },
  failed: { field: 'code', text: 'Could not check that code. Try again in a moment.' },
  age: { field: 'age', text: 'During the beta, HeyNaija is open to people aged 18 or older. Confirm your age to continue.' },
}

// One page, one form: the invite code and the 18+ box sit above the email and
// handle, and the form posts to ./continue, which checks the invite before Kratos
// sends a code. An invite link (/join?code=…) arrives here with the code filled in.
async function SignupForm({ searchParams }: Pick<PageProps<'/signup'>, 'searchParams'>) {
  const [params, jar] = await Promise.all([searchParams, cookies()])
  const draft = readDraft(jar.get(SIGNUP_DRAFT_COOKIE)?.value)
  const problem = typeof params.invite === 'string' && params.invite in PROBLEMS ? PROBLEMS[params.invite as InviteProblem] : null
  return (
    <AuthForm
      kind="registration"
      flowId={params.flow}
      signup={{
        fields: <InviteFields code={draft.code ?? jar.get(INVITE_COOKIE)?.value ?? ''} adult={draft.adult || jar.has(AGE_COOKIE)} problem={problem} />,
        action: (flow) => `/signup/continue?flow=${encodeURIComponent(flow)}`,
        values: { 'traits.email': draft.email, 'traits.handle': draft.handle },
      }}
    />
  )
}

function InviteFields({ code, adult, problem }: { code: string; adult: boolean; problem: (typeof PROBLEMS)[InviteProblem] | null }) {
  const codeError = problem?.field === 'code' ? problem.text : null
  const ageError = problem?.field === 'age' ? problem.text : null
  return (
    <>
      <div className="flex flex-col gap-2">
        <label htmlFor="invite-code" className="field-label">
          Invite code
        </label>
        <input
          id="invite-code"
          name="invite_code"
          type="text"
          required
          defaultValue={code}
          autoCapitalize="characters"
          autoCorrect="off"
          spellCheck={false}
          autoComplete="off"
          placeholder="HN-XXXX-XXXX-XXXX"
          aria-invalid={Boolean(codeError) || undefined}
          aria-describedby={codeError ? 'invite-code-error' : 'invite-code-hint'}
          className={`field min-h-12 font-mono uppercase tracking-wider placeholder:normal-case placeholder:tracking-normal ${codeError ? 'border-danger' : ''}`}
        />
        {codeError ? (
          <p id="invite-code-error" role="alert" className="text-sm leading-relaxed text-danger">{codeError}</p>
        ) : (
          <p id="invite-code-hint" className="field-hint">You'll find this in the invite shared with you.</p>
        )}
      </div>
      <div className="flex flex-col gap-2">
        <label className="join-age">
          <input
            type="checkbox"
            name="adult"
            value="yes"
            required
            defaultChecked={adult}
            aria-invalid={Boolean(ageError) || undefined}
            aria-describedby={ageError ? 'join-age-error' : 'join-age-hint'}
          />
          <span>I am 18 or older</span>
        </label>
        {ageError ? (
          <p id="join-age-error" role="alert" className="text-sm leading-relaxed text-danger">{ageError}</p>
        ) : (
          <p id="join-age-hint" className="field-hint">
            During the beta, accounts are 18+. We don’t ask for your date of birth or any ID.
          </p>
        )}
      </div>
    </>
  )
}
