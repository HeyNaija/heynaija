'use client'

import { useRef, useState } from 'react'
import { finishCommunityPhotoUpload, removeCommunityPhoto, startCommunityPhotoUpload } from '@/app/actions'
import { IMAGE_TYPES, shrinkImage } from './shrink-image'

const MAX_BYTES = 5 * 1024 * 1024

/**
 * For a community's moderators: add, replace or remove its square photo. The
 * photo is shrunk in the browser first, so a phone picture costs little data,
 * then goes straight to storage like a profile photo. Needs JavaScript; everyone
 * else, with or without it, simply sees the photo or the subject icon.
 */
export function CommunityPhotoEditor({ slug, hasPhoto, siteModerator }: { slug: string; hasPhoto: boolean; siteModerator: boolean }) {
  const input = useRef<HTMLInputElement>(null)
  const [status, setStatus] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
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
      const ticket = await startCommunityPhotoUpload(slug, image.type, image.size)
      if ('error' in ticket) return setError(ticket.error)
      try {
        const put = await fetch(ticket.uploadUrl, { method: 'PUT', headers: { 'content-type': image.type }, body: image })
        if (!put.ok) throw new Error(String(put.status))
      } catch {
        return setError('The upload did not go through. Check your connection and try again.')
      }

      setStatus('Saving…')
      const result = await finishCommunityPhotoUpload(slug, ticket.mediaId)
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
      const result = await removeCommunityPhoto(slug, siteModerator)
      if (result.error) setError(result.error)
    } finally {
      setStatus(null)
      setBusy(false)
    }
  }

  return (
    <div className="mt-4">
      <div className="community-photo-editor">
        <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={() => input.current?.click()}>
          {hasPhoto ? 'Change community photo' : 'Add a community photo'}
        </button>
        {hasPhoto ? (
          <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={remove}>
            Remove photo
          </button>
        ) : null}
        <input
          ref={input}
          type="file"
          accept={IMAGE_TYPES.join(',')}
          className="sr-only"
          aria-label="Community photo"
          tabIndex={-1}
          onChange={(e) => {
            const file = e.target.files?.[0]
            e.target.value = '' // so choosing the same file again still fires
            if (file) void upload(file)
          }}
        />
      </div>
      <p role="status" className="field-hint mt-2 empty:hidden">
        {status}
      </p>
      <p role="alert" className="mt-1 text-sm text-danger empty:hidden">
        {error}
      </p>
    </div>
  )
}
