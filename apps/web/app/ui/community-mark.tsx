import { Clapperboard, GraduationCap, Laptop, MapPin, Users } from 'lucide-react'

/**
 * A community's own photo when its moderators have uploaded one, otherwise a
 * familiar subject marker. Decorative either way: the community's name is always
 * printed beside it. `priority` loads the photo at once, for a page's header.
 */
export function CommunityMark({
  slug,
  photo,
  large = false,
  priority = false,
}: {
  slug: string
  photo?: string | null
  large?: boolean
  priority?: boolean
}) {
  if (photo) {
    const size = large ? 52 : 38
    return (
      <span className={`community-mark has-photo${large ? ' is-large' : ''}`}>
        {/* A plain <img>: the stored sizes (96 and 256) are already what is needed, and the browser picks one for the screen. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={`${photo}/256.webp`}
          srcSet={`${photo}/96.webp 96w, ${photo}/256.webp 256w`}
          sizes={`${size}px`}
          alt=""
          width={size}
          height={size}
          loading={priority ? 'eager' : 'lazy'}
          decoding="async"
        />
      </span>
    )
  }
  const Icon = slug.includes('tech') ? Laptop
    : /universit|campus|student/.test(slug) ? GraduationCap
    : /lagos|abuja/.test(slug) ? MapPin
    : /entertainment|culture/.test(slug) ? Clapperboard
    : Users
  return <span className={`community-mark ${large ? 'is-large' : ''}`}><Icon size={large ? 26 : 19} strokeWidth={1.7} aria-hidden="true" /></span>
}
