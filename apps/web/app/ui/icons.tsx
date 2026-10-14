import {
  Bookmark,
  ChevronDown,
  Ellipsis,
  Flame,
  Heart,
  House,
  type LucideIcon,
  MessageCircle,
  Plus,
  Search,
  Settings,
  Shield,
  User,
  Users,
  Vote,
} from 'lucide-react'

// One icon set (Lucide) behind our own names, so the whole app draws icons at the
// same weight and a swap later touches only this file.
type Props = { size?: number; filled?: boolean }

const icon = (Glyph: LucideIcon) =>
  function Icon({ size = 20, filled = false }: Props) {
    return (
      <Glyph
        aria-hidden="true"
        size={size}
        strokeWidth={1.900}
        fill={filled ? 'currentColor' : 'none'}
        className="shrink-0"
      />
    )
  }

export const HomeIcon = icon(House)
export const PeopleIcon = icon(Users)
export const BookmarkIcon = icon(Bookmark)
export const GearIcon = icon(Settings)
export const SearchIcon = icon(Search)
export const HeartIcon = icon(Heart)
export const BubbleIcon = icon(MessageCircle)
export const PlusIcon = icon(Plus)
export const UserIcon = icon(User)
export const DotsIcon = icon(Ellipsis)
export const ChevronIcon = icon(ChevronDown)
export const FlameIcon = icon(Flame)
export const ShieldIcon = icon(Shield)
export const VoteIcon = icon(Vote)
