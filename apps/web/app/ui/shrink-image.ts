// Shrinks a photo in the browser before anything is sent. On a mobile connection
// this turns a multi-megabyte photo into a few hundred kilobytes, and re-encoding
// also drops the location data cameras embed. If the browser cannot do it, the
// original is returned and the server does the same work.

export const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp']
/** What a post may carry: a GIF too, sent as it is (redrawing it here would flatten it to one frame). */
export const POST_IMAGE_TYPES = [...IMAGE_TYPES, 'image/gif']
export const isGif = (file: { type: string }) => file.type === 'image/gif'

/**
 * `square`: crop to a centred square `max` pixels wide (profile photos).
 * Otherwise keep the proportions and fit the longest edge within `max`.
 */
export async function shrinkImage(file: File, { max, square = false }: { max: number; square?: boolean }): Promise<Blob> {
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
    const side = Math.min(bitmap.width, bitmap.height)
    const crop = square
      ? { x: (bitmap.width - side) / 2, y: (bitmap.height - side) / 2, w: side, h: side }
      : { x: 0, y: 0, w: bitmap.width, h: bitmap.height }
    const scale = Math.min(1, max / Math.max(crop.w, crop.h))
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(crop.w * scale)
    canvas.height = Math.round(crop.h * scale)
    canvas.getContext('2d')!.drawImage(bitmap, crop.x, crop.y, crop.w, crop.h, 0, 0, canvas.width, canvas.height)
    bitmap.close()

    const encode = (type: string) => new Promise<Blob | null>((done) => canvas.toBlob(done, type, 0.86))
    // Some browsers cannot write WebP and quietly hand back a PNG instead.
    const webp = await encode('image/webp')
    if (webp?.type === 'image/webp') return webp
    const jpeg = await encode('image/jpeg')
    if (jpeg?.type === 'image/jpeg') return jpeg
  } catch {
    // Fall through to the original file.
  }
  return file
}
