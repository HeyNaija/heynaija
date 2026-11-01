/**
 * Where a video's files live (ADR 0019 section 3.5). Fixed per media ID, so a
 * rerun overwrites rather than piling up.
 *
 * - `uploads` (private): the original while it is being processed, and every
 *   quarantined copy under `quarantine/`, which no lifecycle rule may touch.
 * - `media` (public): only what the worker made: the MP4s and the poster.
 */
export const originalKey = (id: string) => `videos/${id}`
export const renditionKey = (id: string, label: number) => `videos/${id}/${label}.mp4`
export const posterKey = (id: string) => `videos/${id}/poster.webp`
/** The original of a video the scanner matched, or that no scanner has cleared. Evidence: never swept. */
export const quarantineOriginalKey = (id: string) => `quarantine/originals/videos/${id}`
/** A published file moved out of public view, as for images. */
export const quarantinedKey = (key: string) => `quarantine/${key}`

/**
 * Where readers fetch a video's files, without the file name: the web app appends
 * `/poster.webp` or `/360.mp4`. A path, like images'. Serving it from the media
 * bucket's own domain rather than through nginx is a launch-gate item (ADR 3.3).
 */
export const videoPath = (id: string) => `/media/videos/${id}`
