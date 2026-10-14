'use client'

import { useRef, useState } from 'react'
import { finishAvatarUpload, removeAvatar, startAvatarUpload } from '@/app/actions'
import { Avatar } from './avatar'
import { IMAGE_TYPES, shrinkImage } from './shrink-image'

const MAX_BYTES = 5 * 1024 * 1024

export function AvatarUploader({ handle, avatar }: { handle: string; avatar: string | null }) {
  const input = useRef<HTMLInputElement>(null)
  const [status, setStatus] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  // Plain state, not a transition: each step's message must show as it happens.
  const [busy, setBusy] = useState(false)

  const upload = async (file: File) => {
    setError(null)
    if (!IMAGE_TYPES.includes(file.type)) return setError('Choose a JPEG, PNG or WebP image.')

    setBusy(true)
    try {
      setStatus('Preparing…')
      const image = await shrinkImage(file, { max: 512, square: true })
      if (image.size > MAX_BYTES) return setError('That image is too large. The limit is 5 MB.')

      setStatus('Uploading…')
      const ticket = await startAvatarUpload(image.type, image.size)
      if ('error' in ticket) return setError(ticket.error)
      try {
        // Straight to storage: the image never passes through our servers on the way in.
        const put = await fetch(ticket.uploadUrl, { method: 'PUT', headers: { 'content-type': image.type }, body: image })
        if (!put.ok) throw new Error(String(put.status))
      } catch {
        return setError('The upload did not go through. Check your connection and try again.')
      }

      setStatus('Saving…')
      const result = await finishAvatarUpload(ticket.mediaId)
      if (result.error) setError(result.error)
    } finally {
      setStatus(null)
      setBusy(false)
    }
  }

  const remove = async () => {
    setError(null)
    setBusy(true)
    try {
      setStatus('Removing…')
      await removeAvatar()
    } finally {
      setStatus(null)
      setBusy(false)
    }
  }

  return (
    <div className="flex items-center gap-4">
      <Avatar handle={handle} src={avatar} size={72} />
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={() => input.current?.click()}>
            {avatar ? 'Change photo' : 'Add a photo'}
          </button>
          {avatar ? (
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              disabled={busy}
              onClick={remove}
            >
              Remove photo
            </button>
          ) : null}
        </div>
        <input
          ref={input}
          type="file"
          accept={IMAGE_TYPES.join(',')}
          className="sr-only"
          aria-label="Profile photo"
          tabIndex={-1}
          onChange={(e) => {
            const file = e.target.files?.[0]
            e.target.value = '' // so choosing the same file again still fires
            if (file) void upload(file)
          }}
        />
        <p role="status" className="field-hint mt-2">
          {status ?? 'JPEG, PNG or WebP. It is cropped to a square.'}
        </p>
        <p role="alert" className="mt-1 text-sm text-danger empty:hidden">
          {error}
        </p>
      </div>
    </div>
  )
}
