import {
  ArrowUpRight,
  BadgeCheck,
  Bell,
  Bookmark,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleCheck,
  CircleDashed,
  CircleDot,
  Ellipsis,
  FileText,
  Flag,
  Flame,
  Heart,
  History,
  House,
  IdCard,
  ImagePlus,
  KeyRound,
  Landmark,
  type LucideIcon,
  MessageCircle,
  Plus,
  Search,
  Settings,
  Share2,
  Shield,
  User,
  UserPlus,
  Users,
  Vote,
  Wallet,
  X,
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
export const ShareIcon = icon(Share2)
export const CheckIcon = icon(Check)
export const PlusIcon = icon(Plus)
export const UserIcon = icon(User)
export const DotsIcon = icon(Ellipsis)
export const ChevronIcon = icon(ChevronDown)
export const FlameIcon = icon(Flame)
export const ShieldIcon = icon(Shield)
export const VoteIcon = icon(Vote)
export const ImageIcon = icon(ImagePlus)
export const CloseIcon = icon(X)
export const PreviousIcon = icon(ChevronLeft)
export const NextIcon = icon(ChevronRight)
export const ArrowUpRightIcon = icon(ArrowUpRight)
export const GovernanceIcon = icon(Landmark)
export const TreasuryIcon = icon(Wallet)
export const HistoryIcon = icon(History)
export const BellIcon = icon(Bell)
export const FollowIcon = icon(UserPlus)
export const FlagIcon = icon(Flag)
export const VerifiedIcon = icon(BadgeCheck)
export const IdentityIcon = icon(IdCard)
export const DocumentIcon = icon(FileText)
export const DoneIcon = icon(CircleCheck)
export const InProgressIcon = icon(CircleDot)
export const NotStartedIcon = icon(CircleDashed)
export const OwnershipIcon = icon(KeyRound)
