// A member's profile photo, or their initial on a tint picked from their handle
// (always the same tint for the same person) when they have not set one. The
// tints are CSS variables so they follow the theme.
const TONES = 8

export function Avatar({
  handle,
  src,
  size = 40,
}: {
  handle: string
  /** Avatar path from the API, without the size suffix; null or absent for none. */
  src?: string | null
  size?: number
}) {
  let hash = 0
  for (const ch of handle) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0
  const tone = `avatar-tone-${hash % TONES}`

  if (src) {
    // Two stored sizes; pick the one that still looks sharp on a 2x screen.
    const variant = size <= 48 ? 96 : 256
    return (
      // Decorative: the handle is always printed next to it. A plain <img> because
      // these are already exactly the sizes we need; there is nothing to optimise.
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={`${src}/${variant}.webp`}
        alt=""
        width={size}
        height={size}
        loading="lazy"
        decoding="async"
        className={`avatar-photo ${tone} shrink-0 rounded-full object-cover`}
        style={{ width: size, height: size }}
      />
    )
  }

  return (
    <span
      aria-hidden="true"
      className={`avatar-initial ${tone} inline-flex shrink-0 select-none items-center justify-center rounded-full font-bold uppercase`}
      style={{ width: size, height: size, fontSize: size * 0.36 }}
    >
      {handle.slice(0, 1)}
    </span>
  )
}
