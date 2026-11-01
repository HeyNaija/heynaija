'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { completeVideoUpload, removeVideo, resumeVideoUpload, startVideoUpload, type VideoPlan, videoStatus, type VideoStatus } from '@/app/actions'
import { checkVideoFile, formatSize } from '@/lib/video'

/** A video being attached to a post, from choosing it to the worker having published it. */
export type VideoDraft = {
  name: string
  size: number
  mediaId: string | null
  /** uploading (0..1 sent), processing (the worker has it), ready, held (kept back for a safety check), or stopped. */
  status: 'uploading' | 'processing' | 'ready' | 'held' | 'rejected' | 'failed'
  progress: number
  /** What to tell the member when it stopped, or null. */
  error: string | null
  /** The upload broke part-way and the same file can be continued. */
  canRetry: boolean
  description: string
}

const wait = (ms: number) => new Promise((done) => setTimeout(done, ms))
const PARALLEL = 2
const RETRIES = 3

const REASONS: Record<string, string> = {
  too_long: 'That video is too long. The limit is 60 seconds.',
  too_short: 'That video is too short. The least is 3 seconds.',
  too_large: 'That video is too large. The limit is 100 MB.',
  too_big_picture: 'That video is bigger than 1080p. Record it at a lower quality.',
  not_a_video: 'That file could not be read as a video.',
}

/** The clip's length from the browser's own player, or undefined when it cannot read this format (HEVC on some browsers). */
function readDuration(file: File): Promise<number | undefined> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file)
    const el = document.createElement('video')
    const done = (ms?: number) => {
      URL.revokeObjectURL(url)
      el.removeAttribute('src')
      resolve(ms)
    }
    const timer = setTimeout(() => done(), 4000)
    el.preload = 'metadata'
    el.onloadedmetadata = () => {
      clearTimeout(timer)
      done(Number.isFinite(el.duration) ? el.duration * 1000 : undefined)
    }
    el.onerror = () => {
      clearTimeout(timer)
      done()
    }
    el.src = url
  })
}

/** One PUT of a slice of the file, with progress. Rejects on any failure so the caller can retry. */
function putPart(url: string, body: Blob, onProgress: (sent: number) => void, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('PUT', url)
    xhr.upload.onprogress = (e) => onProgress(e.loaded)
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(String(xhr.status))))
    xhr.onerror = () => reject(new Error('network'))
    xhr.onabort = () => reject(new Error('aborted'))
    signal.addEventListener('abort', () => xhr.abort(), { once: true })
    xhr.send(body)
  })
}

/**
 * Sends a chosen video straight to storage in parts (two at a time, each retried
 * three times), so a dropped connection costs one part; then waits for the worker.
 * Only a ready video can go on a post. A held one (no safety scan has cleared it)
 * never becomes ready.
 */
export function useVideoDraft() {
  const [draft, setDraft] = useState<VideoDraft | null>(null)
  const file = useRef<File | null>(null)
  const abort = useRef<AbortController | null>(null)
  // Bumped on remove, so work for a video that was removed stops quietly.
  const generation = useRef(0)

  useEffect(() => () => abort.current?.abort(), [])

  const patch = (g: number, p: Partial<VideoDraft>) => {
    if (g === generation.current) setDraft((d) => (d ? { ...d, ...p } : d))
  }

  const settle = (g: number, result: VideoStatus | null) => {
    if (!result) return patch(g, { status: 'failed', error: 'That upload has expired. Remove it and add it again.', canRetry: false })
    if (result.status === 'ready') return patch(g, { status: 'ready', progress: 1, error: null })
    if (result.status === 'quarantined') {
      return patch(g, { status: 'held', error: 'This video is being held for a safety check, so it cannot be posted yet.' })
    }
    if (result.status === 'rejected') return patch(g, { status: 'rejected', error: REASONS[result.reason ?? ''] ?? 'That video could not be used.' })
    if (result.status === 'failed') return patch(g, { status: 'failed', error: 'We could not process that video. Remove it and try again.', canRetry: false })
  }

  const waitForWorker = async (g: number, mediaId: string) => {
    // About five minutes: a minute of video takes the worker a minute or two.
    for (let i = 0; i < 150; i++) {
      if (g !== generation.current) return
      const status = await videoStatus(mediaId).catch(() => undefined)
      if (status === undefined) {
        await wait(3000)
        continue
      }
      if (status === null || status.status !== 'processing') return settle(g, status)
      await wait(i < 5 ? 1500 : 2000)
    }
    patch(g, { status: 'failed', error: 'This is taking too long. Remove the video and try again.', canRetry: false })
  }

  const sendParts = async (g: number, plan: VideoPlan, f: File) => {
    const controller = new AbortController()
    abort.current = controller
    const sent = new Map<number, number>(plan.done.map((p) => [p.partNumber, p.size]))
    const report = () => patch(g, { progress: Math.min(0.99, [...sent.values()].reduce((a, b) => a + b, 0) / f.size) })
    report()
    const queue = [...plan.parts]
    const worker = async () => {
      for (let part = queue.shift(); part; part = queue.shift()) {
        const start = (part.partNumber - 1) * plan.partSize
        const slice = f.slice(start, start + part.bytes)
        for (let attempt = 0; ; attempt++) {
          try {
            await putPart(part.url, slice, (loaded) => (sent.set(part.partNumber, loaded), report()), controller.signal)
            sent.set(part.partNumber, part.bytes)
            report()
            break
          } catch (err) {
            sent.set(part.partNumber, 0)
            if (controller.signal.aborted || attempt >= RETRIES) throw err
            await wait(1000 * 2 ** attempt)
          }
        }
      }
    }
    await Promise.all(Array.from({ length: PARALLEL }, worker))
  }

  const run = async (g: number, plan: VideoPlan, f: File) => {
    try {
      await sendParts(g, plan, f)
    } catch {
      if (g === generation.current && !abort.current?.signal.aborted) {
        patch(g, { status: 'failed', error: 'The upload was interrupted. Check your connection, then continue.', canRetry: true })
      }
      return
    }
    if (g !== generation.current) return
    const done = await completeVideoUpload(plan.mediaId)
    if ('error' in done) return patch(g, { status: 'failed', error: done.error, canRetry: true })
    patch(g, { status: 'processing', progress: 1, error: null, canRetry: false })
    if (done.status === 'processing') void waitForWorker(g, plan.mediaId)
    else settle(g, done)
  }

  /** Picks up a broken upload: asks which parts storage holds and sends only the rest. */
  const retry = async () => {
    const f = file.current
    const g = generation.current
    if (!f || !draft?.mediaId) return
    patch(g, { status: 'uploading', error: null, canRetry: false })
    const plan = await resumeVideoUpload(draft.mediaId)
    if ('error' in plan) return patch(g, { status: 'failed', error: plan.error, canRetry: false })
    await run(g, plan, f)
  }

  const choose = async (f: File) => {
    const g = ++generation.current
    abort.current?.abort()
    file.current = f
    const fresh = { name: f.name, size: f.size, mediaId: null, status: 'uploading', progress: 0, error: null, canRetry: false, description: '' } satisfies VideoDraft
    const early = checkVideoFile(f)
    if (early) return setDraft({ ...fresh, status: 'failed', error: early })
    setDraft(fresh)
    const duration = await readDuration(f)
    const refused = checkVideoFile(f, duration)
    if (refused) return patch(g, { status: 'failed', error: refused })
    const plan = await startVideoUpload(f.type || 'video/mp4', f.size, duration)
    if ('error' in plan) return patch(g, { status: 'failed', error: plan.error })
    patch(g, { mediaId: plan.mediaId })
    await run(g, plan, f)
  }

  const remove = useCallback(() => {
    generation.current++
    abort.current?.abort()
    file.current = null
    setDraft((d) => {
      if (d?.mediaId) void removeVideo(d.mediaId)
      return null
    })
  }, [])

  /** After a post, or a reset: forget the draft without deleting what the post now owns. */
  const clear = useCallback(() => {
    generation.current++
    abort.current?.abort()
    file.current = null
    setDraft(null)
  }, [])

  const describe = (description: string) => setDraft((d) => (d ? { ...d, description } : d))

  return { draft, choose, retry, remove, clear, describe, sizeLabel: draft ? formatSize(draft.size) : '' }
}
