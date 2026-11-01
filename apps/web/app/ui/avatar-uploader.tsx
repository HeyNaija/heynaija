'use client'

import { useRef } from 'react'
import { finishAvatarUpload, removeAvatar, startAvatarUpload } from '@/app/actions'
import { Avatar } from './avatar'
import { IMAGE_TYPES } from './shrink-image'
import { useSquarePhotoUpload } from './use-square-photo-upload'

export function AvatarUploader({ handle, avatar }: { handle: string; avatar: string | null }) {
  const input = useRef<HTMLInputElement>(null)
  const { status, error, busy, choose, remove } = useSquarePhotoUpload({
    start: startAvatarUpload,
    finish: finishAvatarUpload,
    remove: removeAvatar,
  })

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
          onChange={choose}
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
