import {
  ArrowUpRight,
  AtSign,
  Award,
  BadgeCheck,
  Bell,
  Bookmark,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  CircleCheck,
  CircleDashed,
  CircleDot,
  Ellipsis,
  FileText,
  Flag,
  Flame,
  Hash,
  Pin,
  Heart,
  History,
  House,
  IdCard,
  ImagePlus,
  Info,
  KeyRound,
  Landmark,
  Lightbulb,
  Link,
  type LucideIcon,
  MessageCircle,
  Pause,
  Play,
  Plus,
  Quote,
  Repeat2,
  Search,
  Settings,
  Share,
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
export const InfoIcon = icon(Info)
export const PeopleIcon = icon(Users)
export const BookmarkIcon = icon(Bookmark)
export const GearIcon = icon(Settings)
export const SearchIcon = icon(Search)
export const HeartIcon = icon(Heart)
export const BubbleIcon = icon(MessageCircle)
export const ShareIcon = icon(Share2)
/** Safari's Share button on iPhone and iPad, a box with an arrow, as the install steps describe it. */
export const AppleShareIcon = icon(Share)
export const LinkIcon = icon(Link)
export const RepostIcon = icon(Repeat2)
export const QuoteIcon = icon(Quote)
export const MentionIcon = icon(AtSign)
export const CheckIcon = icon(Check)
export const PlusIcon = icon(Plus)
export const UserIcon = icon(User)
export const DotsIcon = icon(Ellipsis)
export const ChevronIcon = icon(ChevronDown)
export const UpvoteIcon = icon(ChevronUp)
export const FlameIcon = icon(Flame)
export const HashIcon = icon(Hash)
export const PinIcon = icon(Pin)
export const ShieldIcon = icon(Shield)
export const VoteIcon = icon(Vote)
export const ImageIcon = icon(ImagePlus)
export const CloseIcon = icon(X)
export const PlayIcon = icon(Play)
export const PauseIcon = icon(Pause)
export const PreviousIcon = icon(ChevronLeft)
export const NextIcon = icon(ChevronRight)
export const ArrowUpRightIcon = icon(ArrowUpRight)
export const GovernanceIcon = icon(Landmark)
export const TreasuryIcon = icon(Wallet)
export const HistoryIcon = icon(History)
export const IdeaIcon = icon(Lightbulb)
export const BellIcon = icon(Bell)
export const FollowIcon = icon(UserPlus)
export const FlagIcon = icon(Flag)
export const VerifiedIcon = icon(BadgeCheck)

export const AwardIcon = icon(Award)
export const IdentityIcon = icon(IdCard)
export const DocumentIcon = icon(FileText)
export const DoneIcon = icon(CircleCheck)
export const InProgressIcon = icon(CircleDot)
export const NotStartedIcon = icon(CircleDashed)
export const OwnershipIcon = icon(KeyRound)

/** "GIF" in a small frame, so it reads as something other than the photo icon next to it. */
export function GifIcon({ size = 20 }: Props) {
  return (
    <span aria-hidden="true" className="gif-glyph" style={{ width: size, height: Math.round(size * 0.8), fontSize: Math.round(size * 0.4) }}>
      GIF
    </span>
  )
}

// Service marks for share destinations, kept monochrome to follow the app theme.
export function WhatsAppIcon({ size = 20 }: Props) {
  return <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="currentColor"><path d="M20.52 3.48A11.9 11.9 0 0 0 12.05 0C5.46 0 .1 5.36.1 11.95c0 2.1.55 4.16 1.6 5.97L0 24l6.24-1.64a11.96 11.96 0 0 0 5.8 1.48h.01C18.64 23.84 24 18.48 24 11.9c0-3.19-1.24-6.18-3.48-8.42ZM12.05 21.82a9.9 9.9 0 0 1-5.04-1.38l-.36-.22-3.7.97.99-3.6-.24-.38a9.86 9.86 0 0 1-1.51-5.26c0-5.48 4.46-9.94 9.95-9.94a9.87 9.87 0 0 1 7.03 2.91 9.86 9.86 0 0 1 2.91 7.03c0 5.48-4.46 9.87-10.03 9.87Zm5.45-7.4c-.3-.15-1.77-.87-2.04-.97-.28-.1-.48-.15-.68.15-.2.3-.77.97-.94 1.17-.17.2-.35.22-.65.07-.3-.15-1.26-.46-2.4-1.48-.89-.79-1.49-1.77-1.66-2.07-.17-.3-.02-.46.13-.61.13-.13.3-.35.45-.52.15-.18.2-.3.3-.5.1-.2.05-.37-.03-.52-.07-.15-.67-1.62-.92-2.22-.24-.58-.49-.5-.67-.51h-.57c-.2 0-.52.07-.79.37-.27.3-1.04 1.02-1.04 2.49s1.07 2.89 1.22 3.09c.15.2 2.1 3.2 5.1 4.49.71.3 1.27.48 1.7.61.71.23 1.37.2 1.88.12.57-.09 1.77-.72 2.02-1.42.25-.7.25-1.3.17-1.42-.07-.12-.27-.2-.57-.35Z" /></svg>
}

export function XBrandIcon({ size = 20 }: Props) {
  return <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="currentColor"><path d="M18.9 1.15h3.68l-8.04 9.19L24 22.85h-7.4l-5.8-7.58-6.64 7.58H.48l8.6-9.83L0 1.15h7.59l5.24 6.93 6.07-6.93Zm-1.29 19.5h2.04L6.48 3.24H4.29L17.61 20.65Z" /></svg>
}

export function TelegramIcon({ size = 20 }: Props) {
  return <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="currentColor"><path d="M21.94 2.09 1.07 10.14c-1.42.57-1.41 1.36-.26 1.71l5.35 1.67 2.05 6.29c.25.69.13.97.86.97.56 0 .8-.25 1.11-.55l2.67-2.6 5.55 4.1c1.02.56 1.76.27 2.01-.95l3.64-17.15c.37-1.49-.57-2.17-1.55-1.54ZM7 13.14 19.07 5.5c.6-.36 1.15-.17.7.23L9.81 14.72l-.39 4.14L7 13.14Z" /></svg>
}

export function FacebookIcon({ size = 20 }: Props) {
  return <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="currentColor"><path d="M13.6 24V13.05h3.68l.55-4.27H13.6V6.05c0-1.23.34-2.07 2.12-2.07H18V.16A30.4 30.4 0 0 0 14.68 0c-3.3 0-5.56 2-5.56 5.67v3.11H5.4v4.27h3.72V24h4.48Z" /></svg>
}
