// There are no profile photos yet, so everyone gets their initial on a tint picked
// from their handle (always the same tint for the same person). The tints are CSS
// variables so they follow the theme.
const TONES = 8

export function Avatar({ handle, size = 40 }: { handle: string; size?: number }) {
  let hash = 0
  for (const ch of handle) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0
  return (
    <span
      aria-hidden="true"
      className={`avatar-initial avatar-tone-${hash % TONES} inline-flex shrink-0 select-none items-center justify-center rounded-full font-bold uppercase`}
      style={{ width: size, height: size, fontSize: size * 0.36 }}
    >
      {handle.slice(0, 1)}
    </span>
  )
}
