import { Clapperboard, GraduationCap, Laptop, MapPin, Users } from 'lucide-react'

/** A familiar subject marker for communities that do not have uploaded photos. */
export function CommunityMark({ slug, large = false }: { slug: string; large?: boolean }) {
  const Icon = slug.includes('tech') ? Laptop
    : /universit|campus|student/.test(slug) ? GraduationCap
    : /lagos|abuja/.test(slug) ? MapPin
    : /entertainment|culture/.test(slug) ? Clapperboard
    : Users
  return <span className={`community-mark ${large ? 'is-large' : ''}`}><Icon size={large ? 26 : 19} strokeWidth={1.7} aria-hidden="true" /></span>
}
