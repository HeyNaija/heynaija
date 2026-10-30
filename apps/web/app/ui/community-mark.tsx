import { Clapperboard, GraduationCap, Laptop, MapPin, Users } from 'lucide-react'

/**
 * A community's own photo when its moderators have uploaded one, otherwise a
 * familiar subject marker. Decorative either way: the community's name is always
 * printed beside it.
 */
export function CommunityMark({ slug, photo, large = false }: { slug: string; photo?: string | null; large?: boolean }) {
  if (photo) {
    const size = large ? 52 : 38
    return (
      <span className={`community-mark has-photo ${large ? 'is-large' : ''}`}>
        {/* A plain <img>: the stored sizes (96 and 256) are already what is needed. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={`${photo}/${large ? 256 : 96}.webp`} alt="" width={size} height={size} loading="lazy" decoding="async" />
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
