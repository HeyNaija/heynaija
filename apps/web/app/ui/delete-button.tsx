'use client'

import { useFormStatus } from 'react-dom'

export function DeleteButton() {
  const { pending } = useFormStatus()
  return (
    <button
      type="submit"
      disabled={pending}
      onClick={(e) => {
        if (!confirm('Delete this post? This cannot be undone.')) e.preventDefault()
      }}
      className="rounded px-1 text-xs text-muted hover:text-danger disabled:opacity-50"
    >
      {pending ? 'Deleting…' : 'Delete'}
    </button>
  )
}
