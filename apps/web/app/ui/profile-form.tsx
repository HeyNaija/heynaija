'use client'

import { useActionState, useState } from 'react'
import { type FormState, updateProfile } from '@/app/actions'

const NAME_MAX = 50
const BIO_MAX = 160
const segmenter = new Intl.Segmenter()
const graphemes = (text: string) => [...segmenter.segment(text)].length

/** Name and bio. A plain form, so it also works before JavaScript has loaded. */
export function ProfileForm({ displayName, bio }: { displayName: string | null; bio: string }) {
  const [state, action, pending] = useActionState<FormState, FormData>(updateProfile, {})
  // Controlled, so what was typed survives a refused save.
  const [name, setName] = useState(displayName ?? '')
  const [about, setAbout] = useState(bio)
  const bioLeft = BIO_MAX - graphemes(about.trim())

  return (
    <form action={action} className="flex flex-col gap-4">
      <label className="flex flex-col gap-1.5">
        <span className="field-label">Name</span>
        <input
          name="displayName"
          value={name}
          onChange={(e) => setName(e.target.value)}
          // The browser counts code units, and a flag emoji is four of them; the server counts characters.
          maxLength={NAME_MAX * 4}
          autoComplete="name"
          className="field"
        />
        <span className="field-hint">Shown next to your handle. Leave it empty to use just your handle.</span>
      </label>

      <label className="flex flex-col gap-1.5">
        <span className="flex items-baseline justify-between gap-3">
          <span className="field-label">Bio</span>
          <span className={`text-xs tabular-nums ${bioLeft < 0 ? 'text-danger' : 'text-muted'}`}>{bioLeft}</span>
        </span>
        <textarea
          name="bio"
          value={about}
          onChange={(e) => setAbout(e.target.value)}
          rows={3}
          className="field resize-none"
        />
        <span className="field-hint">A line or two about you. Public, like your posts.</span>
      </label>

      <div className="flex items-center gap-3">
        <button type="submit" disabled={pending || bioLeft < 0 || graphemes(name.trim()) > NAME_MAX} className="btn btn-primary">
          {pending ? 'Saving…' : 'Save'}
        </button>
        <p role="status" className="text-sm text-muted empty:hidden">
          {state.done && !pending ? 'Saved.' : ''}
        </p>
      </div>
      <p role="alert" className="text-sm text-danger empty:hidden">
        {state.error}
      </p>
    </form>
  )
}
