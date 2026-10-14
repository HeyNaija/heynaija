import type { Flow, UiMessage, UiNode } from '@/lib/kratos'

// Kratos describes each form as a list of fields ("nodes"); this renders them as
// plain HTML forms that post straight to Kratos, so they work without JavaScript.

// Friendlier wording than Kratos's defaults, keyed by field name.
const LABELS: Record<string, string> = {
  identifier: 'Email or handle',
  'traits.email': 'Email',
  'traits.handle': 'Handle',
  password: 'Password',
  code: 'Code from the email',
}

// Shorter wording for a few of Kratos's stock messages and buttons, by message ID.
const TEXT: Record<number, string> = {
  1010022: 'Sign in', // "Sign in with password"
  4000006: 'Wrong email, handle or password.',
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
        {(node.meta.label && TEXT[node.meta.label.id]) ?? node.meta.label?.text ?? 'Continue'}
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

// Kratos's order follows the identity schema; people expect the password last.
const rank = (node: UiNode) => {
  const type = node.attributes.type
  if (type === 'hidden') return 0
  if (type === 'submit' || type === 'button') return 3
  return type === 'password' ? 2 : 1
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
 * (the settings flow: profile and password are saved separately).
 */
export function FlowForm({ flow, sections }: { flow: Flow; sections?: Record<string, string> }) {
  const shared = flow.ui.nodes.filter((n) => n.group === 'default')
  const groups = sections ? Object.keys(sections).filter((g) => flow.ui.nodes.some((n) => n.group === g)) : []

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
        <Form flow={flow} nodes={flow.ui.nodes} />
      )}
    </div>
  )
}
