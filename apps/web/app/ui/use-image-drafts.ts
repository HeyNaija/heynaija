'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { finishPostImageUpload, postImageStatus, startPostImageUpload } from '@/app/actions'
import { IMAGE_TYPES, shrinkImage } from './shrink-image'

export const MAX_IMAGES = 4
const MAX_BYTES = 10 * 1024 * 1024
// Long enough for a photo to look sharp full screen, small enough to send on a phone.
const LONGEST_EDGE = 2048

/** An image being attached to a post, from choosing it to the server having processed it. */
export type ImageDraft = {
  key: string
  /** A local copy to show straight away, before anything is uploaded. */
  preview: string
  mediaId: string | null
  status: 'uploading' | 'processing' | 'ready' | 'failed'
  error: string | null
  alt: string
}

const wait = (ms: number) => new Promise((done) => setTimeout(done, ms))

/**
 * Uploads each chosen image straight to storage, then asks the API until its
 * background job has processed it. Only ready images can go on a post.
 */
export function useImageDrafts() {
  const [drafts, setDrafts] = useState<ImageDraft[]>([])
  // Images still in the composer; work for one that was removed stops quietly.
  const live = useRef(new Map<string, string>())

  useEffect(() => {
    const previews = live.current
    return () => previews.forEach((url) => URL.revokeObjectURL(url))
  }, [])

  const update = (key: string, patch: Partial<ImageDraft>) =>
    setDrafts((all) => all.map((d) => (d.key === key ? { ...d, ...patch } : d)))
  const fail = (key: string, error: string) => update(key, { status: 'failed', error })

  const waitUntilReady = async (key: string, mediaId: string) => {
    // About two minutes: quick checks first, since most images take a second or two.
    for (let i = 0; i < 90; i++) {
      if (!live.current.has(key)) return
      const status = await postImageStatus(mediaId).catch(() => 'processing' as const)
      if (status === 'ready') return update(key, { status: 'ready' })
      if (status === 'failed') return fail(key, 'That file is not a JPEG, PNG or WebP image.')
      if (status === null) return fail(key, 'That upload has expired. Remove it and add it again.')
      await wait(i < 5 ? 600 : 1500)
    }
    fail(key, 'This is taking too long. Remove the image and try again.')
  }

  const upload = async (key: string, file: File) => {
    if (!IMAGE_TYPES.includes(file.type)) return fail(key, 'Choose a JPEG, PNG or WebP image.')
    const image = await shrinkImage(file, { max: LONGEST_EDGE })
    if (image.size > MAX_BYTES) return fail(key, 'That image is too large. The limit is 10 MB.')

    const ticket = await startPostImageUpload(image.type, image.size)
    if ('error' in ticket) return fail(key, ticket.error)
    update(key, { mediaId: ticket.mediaId })
    try {
      // Straight to storage: the image never passes through our servers on the way in.
      const put = await fetch(ticket.uploadUrl, { method: 'PUT', headers: { 'content-type': image.type }, body: image })
      if (!put.ok) throw new Error(String(put.status))
    } catch {
      return fail(key, 'The upload did not go through. Check your connection, remove it and try again.')
    }

    const result = await finishPostImageUpload(ticket.mediaId)
    if ('error' in result) return fail(key, result.error)
    if (result.status === 'ready') return update(key, { status: 'ready' })
    update(key, { status: 'processing' })
    void waitUntilReady(key, ticket.mediaId)
  }

  /** Adds as many of `files` as there is room for. Returns how many were left out. */
  const add = (files: File[]): number => {
    const taken = files.slice(0, Math.max(0, MAX_IMAGES - drafts.length))
    const added = taken.map((file) => {
      const preview = URL.createObjectURL(file)
      const key = preview
      live.current.set(key, preview)
      return { file, draft: { key, preview, mediaId: null, status: 'uploading', error: null, alt: '' } satisfies ImageDraft }
    })
    setDrafts((all) => [...all, ...added.map((a) => a.draft)])
    // One at a time: shrinking several large photos at once can exhaust a cheap phone's memory.
    void (async () => {
      for (const { file, draft } of added) {
        if (live.current.has(draft.key)) await upload(draft.key, file).catch(() => fail(draft.key, 'Something went wrong. Remove the image and try again.'))
      }
    })()
    return files.length - taken.length
  }

  const remove = (key: string) => {
    const preview = live.current.get(key)
    if (preview) URL.revokeObjectURL(preview)
    live.current.delete(key)
    setDrafts((all) => all.filter((d) => d.key !== key))
  }

  const clear = useCallback(() => {
    live.current.forEach((url) => URL.revokeObjectURL(url))
    live.current.clear()
    setDrafts([])
  }, [])

  const describe = (key: string, alt: string) => update(key, { alt })

  return { drafts, add, remove, clear, describe }
}
