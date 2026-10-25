import type { SignupStart } from '../../types'
import type { Flow, UiMessage, UiNode } from './client'

// Kratos describes each form as a list of fields ("nodes"); this renders them as
// plain HTML forms that post straight to Kratos, so they work without JavaScript.

// Friendlier wording than Kratos's defaults, keyed by field name.
const LABELS: Record<string, string> = {
  identifier: 'Email address',
  'traits.email': 'Email address',
  'traits.handle': 'Handle',
  code: 'Code from the email',
  email_change_code: 'Code sent to your new email',
}

// Shorter wording for a few of Kratos's stock messages and buttons, by message ID.
const TEXT: Record<number, string> = {
  1010002: 'Continue with Google', // "Sign in with google"
  1010003: 'For your security, confirm it is you before saving changes to your account.',
  1010015: 'Email me a code', // "Send sign in code"
  1040002: 'Continue with Google', // "Sign up with google"
  1040006: 'Email me a code', // "Send sign up code"
  1050002: 'Connect Google', // "Link google"
  1050003: 'Disconnect Google', // "Unlink google"
  4000007: 'An account with that email or handle already exists.',
}

const HINTS: Record<string, string> = {
  'traits.handle': '3–20 characters: lowercase letters, numbers and underscores.',
}

// Kratos reports schema failures in JSON-schema terms; say what the person should do.
const FIELD_ERRORS: Record<string, Record<number, string>> = {
  'traits.handle': {
    4000004: 'Use 3–20 lowercase letters, numbers or underscores.',
    4000001: 'That handle is not available.',
  },
}

const tone = { error: 'text-danger', success: 'text-accent-strong', info: '' } as const

// Above a form, 4000001 carries Kratos's internal reason ("Unable to decode body
// because…", "The HTTP Request Header included the Cookie key…") and 5xxxxxx are
// server faults. Neither is written for people, so they get `fallback` instead.
const technical = (m: UiMessage) => m.type === 'error' && (m.id === 4000001 || m.id >= 5000000)

function Messages({ messages, field, fallback }: { messages?: UiMessage[]; field?: string; fallback?: string }) {
  if (!messages?.length) return null
  const specific = messages.some((m) => m.type === 'error' && !technical(m))
  const lines = messages
    // A specific error already says what went wrong; the generic one adds nothing.
    .filter((m) => !(fallback && technical(m) && specific))
    .map((m) => ({
      type: m.type,
      text: fallback && technical(m) ? fallback : (field && FIELD_ERRORS[field]?.[m.id]) ?? TEXT[m.id] ?? m.text,
    }))
    .filter((line, i, all) => all.findIndex((other) => other.text === line.text) === i)
  return (
    <>
      {lines.map((line) => (
        <p key={line.text} role={line.type === 'error' ? 'alert' : 'status'} className={`text-sm leading-relaxed ${tone[line.type]}`}>
          {line.text}
        </p>
      ))}
    </>
  )
}

function Field({ node, flowId, identifier, googleConnected, filled }: { node: UiNode; flowId: string; identifier?: string; googleConnected?: boolean; filled?: string }) {
  const a = node.attributes
  const name = a.name ?? ''
  // Confirming it is you: only the signed-in address will do, so it is shown, not asked for.
  const locked = name === 'identifier' && a.type !== 'hidden' && identifier !== undefined
  const googleEmail = googleConnected && name === 'traits.email' && a.type !== 'hidden'
  const value = locked ? identifier : a.value === undefined || a.value === null ? filled : String(a.value)
  const hint = googleEmail
    ? 'Disconnect Google in Connected accounts below to change your email address.'
    : locked ? 'The address you are signed in with.' : HINTS[name]

  if (a.type === 'hidden') return <input type="hidden" name={name} value={value ?? ''} />

  if (a.type === 'submit' || a.type === 'button') {
    const label = (node.meta.label && TEXT[node.meta.label.id]) ?? node.meta.label?.text ?? 'Continue'
    // Google: sign in, sign up, or connect and disconnect in settings.
    if (node.group === 'oidc') {
      return (
        <button type="submit" name={name} value={value} disabled={a.disabled} formNoValidate className="btn btn-secondary btn-lg btn-block">
          <GoogleMark />
          {label}
        </button>
      )
    }
    // The main action of a form is "method"; anything else (resend code, etc.) is secondary.
    const primary = name === 'method' || (name === 'email_change_action' && value === 'confirm')
    return (
      <button
        type="submit"
        name={name}
        value={value}
        disabled={a.disabled}
        formNoValidate={!primary}
        className={primary ? 'btn btn-primary btn-lg btn-block' : 'btn btn-ghost min-h-11 self-center text-accent-strong underline-offset-4 hover:underline'}
      >
        {label}
      </button>
    )
  }

  const id = `${flowId}-${node.group}-${name}`
  const hasMessages = Boolean(node.messages?.length)
  const invalid = node.messages?.some((message) => message.type === 'error')
  const description = [hint ? `${id}-hint` : '', hasMessages ? `${id}-messages` : ''].filter(Boolean).join(' ')
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={id} className="field-label">
        {LABELS[name] ?? node.meta.label?.text ?? name}
      </label>
      {/* Disabled controls are not submitted. Keep the email in handle updates. */}
      {googleEmail ? <input type="hidden" name={name} value={value ?? ''} /> : null}
      <input
        id={id}
        name={name}
        type={a.type ?? 'text'}
        defaultValue={a.type === 'password' ? undefined : value}
        required={a.required}
        disabled={a.disabled || googleEmail}
        readOnly={locked || undefined}
        autoComplete={a.autocomplete}
        inputMode={name === 'code' || name === 'email_change_code' ? 'numeric' : undefined}
        pattern={a.pattern}
        title={locked ? undefined : HINTS[name]}
        maxLength={a.maxlength}
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        aria-invalid={invalid || undefined}
        aria-describedby={description || undefined}
        className={`field min-h-12 ${invalid ? 'border-danger' : ''} ${name === 'code' || name === 'email_change_code' ? 'font-mono tracking-[0.18em]' : ''}`}
      />
      {hint ? (
        <p id={`${id}-hint`} className="field-hint">
          {hint}
        </p>
      ) : null}
      {hasMessages ? <div id={`${id}-messages`} className="flex flex-col gap-1"><Messages messages={node.messages} field={name} /></div> : null}
    </div>
  )
}

// Google's own mark, which its sign-in guidelines ask for on the button.
function GoogleMark() {
  return (
    <svg aria-hidden="true" width="18" height="18" viewBox="0 0 48 48">
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
    </svg>
  )
}

// Kratos's order follows the identity schema; buttons go last.
const rank = (node: UiNode) => {
  const type = node.attributes.type
  if (type === 'hidden') return 0
  return type === 'submit' || type === 'button' ? 2 : 1
}

function Form({ flow, nodes: unordered, identifier, googleConnected }: { flow: Flow; nodes: UiNode[]; identifier?: string; googleConnected?: boolean }) {
  const nodes = [...unordered].sort((a, b) => rank(a) - rank(b))
  return (
    <form action={flow.ui.action} method={flow.ui.method} className="flex flex-col gap-5">
      {nodes.map((node, i) => {
        if (node.type === 'input') return <Field key={`${node.attributes.name}-${i}`} node={node} flowId={flow.id} identifier={identifier} googleConnected={googleConnected} />
        if (node.type === 'text') {
          return (
            <p key={i} className="text-sm text-muted">
              {node.meta.label?.text}
            </p>
          )
        }
        if (node.type === 'a' && node.attributes.href) {
          return (
            <a key={i} href={node.attributes.href} className="text-sm underline underline-offset-2">
              {node.attributes.title?.text ?? node.meta.label?.text}
            </a>
          )
        }
        return null
      })}
    </form>
  )
}

/**
 * The first step of a signup as one form: the page's own fields (the invite
 * code), then Google, then email and handle. Both buttons post to the page's
 * route, which checks what is its own and hands the rest on to Kratos. Back from
 * Google with a handle still to choose, it is the invite, the handle, then Google.
 */
function SignupStartForm({ flow, signup, google, rest, afterGoogle }: { flow: Flow; signup: SignupStart; google: UiNode[]; rest: UiNode[]; afterGoogle: boolean }) {
  const nodes = [...rest].sort((a, b) => rank(a) - rank(b))
  const field = (node: UiNode, i: number) => (
    <Field key={`${node.attributes.name}-${i}`} node={node} flowId={flow.id} filled={signup.values?.[node.attributes.name ?? '']} />
  )
  const typed = nodes.filter((n) => n.type === 'input' && n.attributes.type !== 'hidden')
  return (
    <form action={signup.action(flow.id)} method="post" className="flex flex-col gap-5">
      {nodes.filter((n) => n.attributes.type === 'hidden').map(field)}
      {signup.fields}
      {afterGoogle ? (
        <>
          {typed.map(field)}
          {google.map(field)}
        </>
      ) : google.length ? (
        <>
          {google.map(field)}
          <div className="flex items-center gap-3 text-xs text-muted" role="separator">
            <span className="h-px flex-1 bg-line" />
            or use email
            <span className="h-px flex-1 bg-line" />
          </div>
        </>
      ) : null}
      {afterGoogle ? null : typed.map(field)}
    </form>
  )
}

/**
 * `sections` splits a flow into one form per Kratos group, with a heading each
 * (the settings flow: the profile and connected accounts are saved separately).
 * Without sections, Google gets its own form above the email one.
 */
export function FlowForm({
  flow,
  sections,
  fallback = 'That did not go through. Please try again.',
  identifier,
  signup,
}: {
  flow: Flow
  sections?: Record<string, string>
  /** Shown in place of Kratos's internal error text. */
  fallback?: string
  /** The signed-in member's email, when the flow asks them to confirm it is them. */
  identifier?: string
  /** On a registration flow: the page's own fields for its first step, and where that step posts. */
  signup?: SignupStart
}) {
  const shared = flow.ui.nodes.filter((n) => n.group === 'default')
  const groups = sections ? Object.keys(sections).filter((g) => flow.ui.nodes.some((n) => n.group === g)) : []
  const google = flow.ui.nodes.filter((n) => n.group === 'oidc')
  // Kratos offers unlink only for providers already connected to this identity.
  const googleConnected = google.some((n) => n.attributes.name === 'unlink' && n.attributes.value === 'google')
  const rest = flow.ui.nodes.filter((n) => n.group !== 'oidc')
  // Kratos puts missing signup traits in the default group after Google returns.
  // Keep them with the provider button so a new member can finish choosing a handle.
  const completingGoogleSignup = flow.active === 'oidc' && rest.some((n) => n.attributes.name?.startsWith('traits.'))
  const hasEmailForm = rest.some((n) => n.attributes.type === 'submit')
  // The first step of a signup (details still to type, not yet the emailed code),
  // or choosing a handle after Google, which may have begun on the sign-in page.
  const startingSignup = signup && (completingGoogleSignup || rest.some((n) => n.attributes.name === 'traits.email' && n.attributes.type !== 'hidden'))

  return (
    <div className="flex flex-col gap-6">
      {flow.ui.messages?.length ? (
        <div className={`notice flex flex-col gap-2 ${flow.ui.messages.some((m) => m.type === 'error') ? 'notice-danger' : ''}`}>
          <Messages messages={flow.ui.messages} fallback={fallback} />
        </div>
      ) : null}

      {sections ? (
        groups.map((group) => (
          <section key={group} className="flex flex-col gap-3">
            <h2 className="section-title">{sections[group]}</h2>
            <Form flow={flow} nodes={[...shared, ...flow.ui.nodes.filter((n) => n.group === group)]} googleConnected={googleConnected} />
          </section>
        ))
      ) : startingSignup ? (
        <SignupStartForm flow={flow} signup={signup} google={google} rest={rest} afterGoogle={completingGoogleSignup} />
      ) : completingGoogleSignup ? (
        <Form flow={flow} nodes={flow.ui.nodes} />
      ) : (
        <>
          {google.length ? (
            <Form flow={flow} nodes={[...shared.filter((n) => n.attributes.type === 'hidden'), ...google]} />
          ) : null}
          {google.length && hasEmailForm ? (
            <div className="flex items-center gap-3 text-xs text-muted" role="separator">
              <span className="h-px flex-1 bg-line" />
              or use email
              <span className="h-px flex-1 bg-line" />
            </div>
          ) : null}
          {hasEmailForm ? <Form flow={flow} nodes={rest} identifier={identifier} /> : null}
        </>
      )}
    </div>
  )
}
