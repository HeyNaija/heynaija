'use client'

import { useRef } from 'react'
import { finishCommunityPhotoUpload, removeCommunityPhoto, startCommunityPhotoUpload } from '@/app/actions'
import { IMAGE_TYPES } from './shrink-image'
import { useSquarePhotoUpload } from './use-square-photo-upload'

/**
 * For a community's moderators: add, replace or remove its square photo, the
 * same steps as a profile photo. Needs JavaScript; everyone else, with or
 * without it, simply sees the photo or the subject icon.
 */
export function CommunityPhotoEditor({ slug, hasPhoto, siteModerator }: { slug: string; hasPhoto: boolean; siteModerator: boolean }) {
  const input = useRef<HTMLInputElement>(null)
  const photo = useSquarePhotoUpload({
    start: (contentType, bytes) => startCommunityPhotoUpload(slug, contentType, bytes),
    finish: (mediaId) => finishCommunityPhotoUpload(slug, mediaId),
    remove: () => removeCommunityPhoto(slug, siteModerator),
  })

  return (
    <div className="mt-4">
      <div className="community-photo-editor">
        <button type="button" className="btn btn-secondary btn-sm" disabled={photo.disabled} onClick={() => input.current?.click()}>
          {hasPhoto ? 'Change community photo' : 'Add a community photo'}
        </button>
        {hasPhoto ? (
          <button type="button" className="btn btn-ghost btn-sm" disabled={photo.disabled} onClick={photo.remove}>
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
          onChange={photo.choose}
        />
      </div>
      <p role="status" className="field-hint mt-2 empty:hidden">
        {photo.status}
      </p>
      <p role="alert" className="mt-1 text-sm text-danger empty:hidden">
        {photo.error}
      </p>
    </div>
  )
}
