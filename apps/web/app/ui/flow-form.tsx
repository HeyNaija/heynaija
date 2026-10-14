import type { Flow, UiMessage, UiNode } from '@/lib/kratos'

// Kratos describes each form as a list of fields ("nodes"); this renders them as
// plain HTML forms that post straight to Kratos, so they work without JavaScript.

// Friendlier wording than Kratos's defaults, keyed by field name.
const LABELS: Record<string, string> = {
  identifier: 'Email',
  'traits.email': 'Email',
  'traits.handle': 'Handle',
  code: 'Code from the email',
}

// Shorter wording for a few of Kratos's stock messages and buttons, by message ID.
const TEXT: Record<number, string> = {
  1010002: 'Continue with Google', // "Sign in with google"
  1010015: 'Email me a code', // "Send sign in code"
  1040002: 'Continue with Google', // "Sign up with google"
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

function Messages({ messages, field }: { messages?: UiMessage[]; field?: string }) {
  if (!messages?.length) return null
  return (
    <>
      {messages.map((m) => (
        <p key={`${m.id}-${m.text}`} role={m.type === 'error' ? 'alert' : 'status'} className={`text-sm ${tone[m.type]}`}>
          {(field && FIELD_ERRORS[field]?.[m.id]) ?? TEXT[m.id] ?? m.text}
        </p>
      ))}
    </>
  )
}

function Field({ node, flowId }: { node: UiNode; flowId: string }) {
  const a = node.attributes
  const name = a.name ?? ''
  const value = a.value === undefined || a.value === null ? undefined : String(a.value)

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
    const primary = name === 'method'
    return (
      <button
        type="submit"
        name={name}
        value={value}
        disabled={a.disabled}
        formNoValidate={!primary}
        className={primary ? 'btn btn-primary btn-lg btn-block' : 'self-start text-sm font-medium text-accent-strong hover:underline'}
      >
        {label}
      </button>
    )
  }

  const id = `${flowId}-${node.group}-${name}`
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="field-label">
        {LABELS[name] ?? node.meta.label?.text ?? name}
      </label>
      <input
        id={id}
        name={name}
        type={a.type ?? 'text'}
        defaultValue={a.type === 'password' ? undefined : value}
        required={a.required}
        disabled={a.disabled}
        autoComplete={a.autocomplete}
        pattern={a.pattern}
        title={HINTS[name]}
        maxLength={a.maxlength}
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        aria-describedby={HINTS[name] ? `${id}-hint` : undefined}
        className="field"
      />
      {HINTS[name] ? (
        <p id={`${id}-hint`} className="field-hint">
          {HINTS[name]}
        </p>
      ) : null}
      <Messages messages={node.messages} field={name} />
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

function Form({ flow, nodes: unordered }: { flow: Flow; nodes: UiNode[] }) {
  const nodes = [...unordered].sort((a, b) => rank(a) - rank(b))
  return (
    <form action={flow.ui.action} method={flow.ui.method} className="flex flex-col gap-4">
      {nodes.map((node, i) => {
        if (node.type === 'input') return <Field key={`${node.attributes.name}-${i}`} node={node} flowId={flow.id} />
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
 * `sections` splits a flow into one form per Kratos group, with a heading each
 * (the settings flow: the profile and connected accounts are saved separately).
 * Without sections, Google gets its own form above the email one.
 */
export function FlowForm({ flow, sections }: { flow: Flow; sections?: Record<string, string> }) {
  const shared = flow.ui.nodes.filter((n) => n.group === 'default')
  const groups = sections ? Object.keys(sections).filter((g) => flow.ui.nodes.some((n) => n.group === g)) : []
  const google = flow.ui.nodes.filter((n) => n.group === 'oidc')
  const rest = flow.ui.nodes.filter((n) => n.group !== 'oidc')
  // The email form's fields are shown only once Kratos asks for them: after Google,
  // when the handle is still missing, every field is in the Google form.
  const hasEmailForm = rest.some((n) => n.attributes.type === 'submit')

  return (
    <div className="flex flex-col gap-6">
      {flow.ui.messages?.length ? (
        <div className={`notice ${flow.ui.messages.some((m) => m.type === 'error') ? 'notice-danger' : ''}`}>
          <Messages messages={flow.ui.messages} />
        </div>
      ) : null}

      {sections ? (
        groups.map((group) => (
          <section key={group} className="flex flex-col gap-3">
            <h2 className="section-title">{sections[group]}</h2>
            <Form flow={flow} nodes={[...shared, ...flow.ui.nodes.filter((n) => n.group === group)]} />
          </section>
        ))
      ) : (
        <>
          {google.length ? (
            <Form flow={flow} nodes={[...shared.filter((n) => n.attributes.type === 'hidden'), ...google]} />
          ) : null}
          {google.length && hasEmailForm ? (
            <div className="flex items-center gap-3 text-xs text-muted" role="separator">
              <span className="h-px flex-1 bg-line" />
              or
              <span className="h-px flex-1 bg-line" />
            </div>
          ) : null}
          {hasEmailForm ? <Form flow={flow} nodes={rest} /> : null}
        </>
      )}
    </div>
  )
}
