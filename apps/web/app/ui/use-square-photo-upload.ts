'use client'

import { type ChangeEvent, useState } from 'react'
import type { UploadTicket } from '@/app/actions'
import { IMAGE_TYPES, shrinkImage } from './shrink-image'

const MAX_BYTES = 5 * 1024 * 1024

/**
 * The steps of a square photo, a profile or a community photo: shrunk in the
 * browser first, so a phone picture costs little data, then sent straight to
 * storage and published by the API. Each step's message shows as it happens,
 * and anything that goes wrong, a lost connection included, ends in a message.
 */
export function useSquarePhotoUpload({
  start,
  finish,
  remove,
}: {
  start: (contentType: string, bytes: number) => Promise<UploadTicket>
  finish: (mediaId: string) => Promise<{ error?: string }>
  remove: () => Promise<{ error?: string } | void>
}) {
  const [status, setStatus] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  // Plain state, not a transition: each step's message must show as it happens.
  const [busy, setBusy] = useState(false)

  /** Runs `work` with the controls disabled; what it returns, or a throw, becomes the error line. */
  const run = async (work: () => Promise<string | null | undefined>) => {
    setError(null)
    setBusy(true)
    try {
      const problem = await work()
      if (problem) setError(problem)
    } catch {
      setError('Something went wrong. Check your connection and try again.')
    } finally {
      setStatus(null)
      setBusy(false)
    }
  }

  const upload = (file: File) => {
    if (!IMAGE_TYPES.includes(file.type)) return setError('Choose a JPEG, PNG or WebP image.')
    return run(async () => {
      setStatus('Preparing…')
      const image = await shrinkImage(file, { max: 512, square: true })
      if (image.size > MAX_BYTES) return 'That image is too large. The limit is 5 MB.'

      setStatus('Uploading…')
      const ticket = await start(image.type, image.size)
      if ('error' in ticket) return ticket.error
      // Straight to storage: the image never passes through our servers on the way in.
      const put = await fetch(ticket.uploadUrl, { method: 'PUT', headers: { 'content-type': image.type }, body: image }).catch(() => null)
      if (!put?.ok) return 'The upload did not go through. Check your connection and try again.'

      setStatus('Saving…')
      return (await finish(ticket.mediaId)).error
    })
  }

  return {
    status,
    error,
    busy,
    /** For the file input's onChange. */
    choose: (e: ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0]
      e.target.value = '' // so choosing the same file again still fires
      if (file) void upload(file)
    },
    remove: () =>
      run(async () => {
        setStatus('Removing…')
        return (await remove())?.error
      }),
  }
}
