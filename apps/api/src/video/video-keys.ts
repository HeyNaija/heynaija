/**
 * Where a video's files live (ADR 0021 section 4). Fixed per media ID, so a
 * rerun overwrites rather than piling up.
 *
 * - `uploads` (private): the original while it is being processed, and every
 *   quarantined copy under `quarantine/`, which no lifecycle rule may touch.
 * - `media` (public): only what the worker made, all under the video's folder:
 *   the HLS playlists and pieces, and the poster.
 */
export const originalKey = (id: string) => `videos/${id}`
/** Everything a reader fetches is under this one folder, so takedown, release and deletion act on it. */
export const videoFolder = (id: string) => `videos/${id}/`
export const posterKey = (id: string) => `videos/${id}/poster.webp`
/** A file the encode wrote, by its path in the HLS output: `master.m3u8`, `240/index.m3u8`, `240/piece-000.m4s`. */
export const hlsKey = (id: string, path: string) => `videos/${id}/hls/${path}`
/** Every quality. */
export const masterKey = (id: string) => hlsKey(id, 'master.m3u8')
/** 240p to 480p, for the `auto` data setting (ADR 0021 section 7). */
export const master480Key = (id: string) => hlsKey(id, 'master-480.m3u8')
/** One quality, by its label (the short edge: 240, 360, 480, 720, or the clip's own below 240). */
export const playlistKey = (id: string, label: number) => hlsKey(id, `${label}/index.m3u8`)
/** The original of a video the scanner matched, or that no scanner has cleared. Evidence: never swept. */
export const quarantineOriginalKey = (id: string) => `quarantine/originals/videos/${id}`
/** A published file moved out of public view, as for images. */
export const quarantinedKey = (key: string) => `quarantine/${key}`
