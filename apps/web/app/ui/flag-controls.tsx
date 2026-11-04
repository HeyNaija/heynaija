'use client'

import { useActionState } from 'react'
import { type FormState, setFlag } from '@/app/actions'
import type { FlagsAdmin } from '@/lib/api'
import { SubmitButton } from './submit-button'

type Flag = FlagsAdmin['flags'][number]

const describe = (o: Flag['override']) =>
  !o ? 'default' : o.handles.length > 0 ? `only ${o.handles.map((h) => `@${h}`).join(', ')}` : o.enabled === null ? 'default' : o.enabled ? 'on for everyone' : 'off for everyone'

/** Each flag is its own plain form, so this works before JavaScript has loaded. */
function FlagRow({ flag }: { flag: Flag }) {
  const [state, action] = useActionState<FormState, FormData>(setFlag, {})
  const mode = flag.override?.handles.length ? 'list' : flag.override?.enabled === true ? 'on' : flag.override?.enabled === false ? 'off' : 'default'
  return (
    <li className="py-3">
      <form action={action} className="flex flex-col gap-2">
        <input type="hidden" name="key" value={flag.key} />
        <p className="text-sm">
          <span className="font-semibold">{flag.key}</span> <span className="text-muted">({flag.owner})</span>
        </p>
        <p className="text-sm text-muted">{flag.description}</p>
        <p className="text-xs text-muted">
          Default here: {flag.default ? 'on' : 'off'}. Now: {describe(flag.override)}.
          {flag.updatedBy ? ` Last changed by @${flag.updatedBy}.` : ''}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <label className="sr-only" htmlFor={`flag-${flag.key}-mode`}>
            Setting for {flag.key}
          </label>
          <select id={`flag-${flag.key}-mode`} name="mode" defaultValue={mode} className="field field-sm w-auto">
            <option value="default">Follow the default ({flag.default ? 'on' : 'off'})</option>
            <option value="on">On for everyone</option>
            <option value="off">Off for everyone</option>
            <option value="list">Only these members</option>
          </select>
          <label className="sr-only" htmlFor={`flag-${flag.key}-handles`}>
            Members for {flag.key}
          </label>
          <input
            id={`flag-${flag.key}-handles`}
            name="handles"
            defaultValue={flag.override?.handles.map((h) => `@${h}`).join(' ') ?? ''}
            placeholder="@handle @handle"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            className="field field-sm min-w-0 flex-1"
          />
          <SubmitButton className="btn btn-secondary btn-sm">Save</SubmitButton>
        </div>
        <p role="alert" className="text-sm text-danger empty:hidden">
          {state.error}
        </p>
      </form>
    </li>
  )
}

export function FlagControls({ flags }: { flags: FlagsAdmin }) {
  return (
    <div className="flex flex-col gap-4">
      <ul className="flex flex-col divide-y divide-line">
        {flags.flags.map((flag) => (
          <FlagRow key={flag.key} flag={flag} />
        ))}
      </ul>
      <details>
        <summary className="cursor-pointer text-sm font-semibold">Recent changes</summary>
        {flags.changes.length === 0 ? (
          <p className="mt-2 text-sm text-muted">No changes yet.</p>
        ) : (
          <ul className="mt-2 flex flex-col gap-1 text-sm">
            {flags.changes.map((c, i) => (
              <li key={i}>
                {c.actorHandle ? `@${c.actorHandle}` : 'Erasing an account'} changed <span className="font-semibold">{c.flagKey}</span> from {describe(c.before)} to {describe(c.after)} on{' '}
                {new Date(c.createdAt).toISOString().slice(0, 16).replace('T', ' ')} UTC
              </li>
            ))}
          </ul>
        )}
      </details>
    </div>
  )
}
