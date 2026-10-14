import Image from 'next/image'
import Link from 'next/link'
import { Suspense } from 'react'
import { getCommunities, getTrending, getViewer } from '@/lib/api'
import { getLogoutUrl } from '@/lib/kratos'
import { Avatar } from './avatar'
import {
  ArrowUpRightIcon,
  BellIcon,
  BookmarkIcon,
  ChevronIcon,
  FlameIcon,
  GovernanceIcon,
  GearIcon,
  HomeIcon,
  PeopleIcon,
  PlusIcon,
  SearchIcon,
  ShieldIcon,
  UserIcon,
  VoteIcon,
} from './icons'
import { JoinButton } from './join-button'
import { Logo } from './logo'
import { Menu } from './menu'
import { NavLink } from './nav-link'
import { ThemeSwitch } from './theme-switch'
import { TreasuryPreview } from './treasury-preview'
import { UnreadBadge } from './unread-badge'

const NAV = [
  { href: '/', label: 'Home', icon: HomeIcon, exact: true },
  { href: '/c', label: 'Communities', icon: PeopleIcon },
  { href: '/governance', label: 'Governance', icon: GovernanceIcon },
  { href: '/bookmarks', label: 'Bookmarks', icon: BookmarkIcon },
  { href: '/settings', label: 'Settings', icon: GearIcon },
]

export function Sidebar() {
  return (
    <aside className="square-sidebar">
      <div className="sidebar-brand">
        <Logo />
      </div>

      {/* usePathname makes the active highlight request-specific, hence the boundary. */}
      <Suspense>
        <nav aria-label="Main" className="flex flex-col gap-1">
          {NAV.slice(0, 2).map(({ href, label, icon: Icon, exact }) => (
            <NavLink key={href} href={href} exact={exact} className="sidebar-nav-item">
              <Icon />
              {label}
            </NavLink>
          ))}
          <NotificationsLink />
          {NAV.slice(2).map(({ href, label, icon: Icon }) => (
            <NavLink key={href} href={href} className="sidebar-nav-item">
              <Icon />
              {label}
            </NavLink>
          ))}
          <ModerationLink />
        </nav>
      </Suspense>

      <div className="ownership-card">
        <Image
          src="/brand/community-conversation.jpg"
          alt=""
          width={640}
          height={427}
          sizes="232px"
          className="ownership-illustration"
        />
        <div className="ownership-copy">
          <p>A community-owned social network for all Nigerians.</p>
          <div className="my-3 h-0.5 w-6 rounded bg-accent" />
          <p>
            Different places.
            <br />
            Same people.
            <br />A brighter Nigeria together.
          </p>
        </div>
      </div>
    </aside>
  )
}

/** Only moderators see this; the API checks the role again on every request. */
/** Members only, with the unread count. */
async function NotificationsLink() {
  const viewer = await getViewer()
  if (viewer.state !== 'member') return null
  return (
    <NavLink href="/notifications" className="sidebar-nav-item">
      <BellIcon />
      Notifications
      <UnreadBadge count={viewer.me.unreadNotifications} />
    </NavLink>
  )
}

async function ModerationLink() {
  const viewer = await getViewer()
  if (viewer.state !== 'member' || !viewer.me.moderates) return null
  return (
    <NavLink href="/mod" className="sidebar-nav-item">
      <ShieldIcon />
      Moderation
    </NavLink>
  )
}

export function TopBar() {
  return (
    <header className="square-topbar">
      <div className="lg:hidden">
        <Logo size={26} />
      </div>

      <form action="/search" role="search" className="hidden min-w-0 flex-1 lg:block">
        <label className="square-search">
          <SearchIcon size={18} />
          <span className="sr-only">Search</span>
          <input
            type="search"
            name="q"
            required
            minLength={2}
            maxLength={80}
            placeholder="Search people, posts, communities…"
            className="min-w-0 flex-1 bg-transparent text-sm text-ink placeholder:text-muted focus:outline-none"
          />
        </label>
      </form>

      <div className="ml-auto flex items-center gap-1.5">
        <Link href="/governance" aria-label="Governance" className="icon-btn lg:hidden">
          <GovernanceIcon />
        </Link>
        <Link href="/search" aria-label="Search" className="icon-btn lg:hidden">
          <SearchIcon />
        </Link>
        <Suspense fallback={<span className="skeleton size-9 !rounded-full" />}>
          <UserMenu />
        </Suspense>
      </div>
    </header>
  )
}

async function UserMenu() {
  const viewer = await getViewer()

  if (viewer.state === 'anonymous') {
    return (
      <>
        <Link href="/login" className="btn btn-ghost btn-sm hidden sm:inline-flex">
          Sign in
        </Link>
        <Link href="/join" className="btn btn-primary btn-sm">
          Join
        </Link>
      </>
    )
  }

  const logoutUrl = await getLogoutUrl()
  const handle = viewer.state === 'member' ? viewer.me.handle : null
  const avatar = viewer.state === 'member' ? viewer.me.avatar : null

  return (
    <Menu
      label="Account menu"
      triggerClassName="flex items-center gap-2 rounded-lg p-1 pr-2 transition-colors hover:bg-panel"
      trigger={
        <>
          {handle ? <Avatar handle={handle} src={avatar} size={34} /> : <UserIcon />}
          <span className="hidden max-w-32 truncate text-sm font-semibold sm:block">{handle ?? 'Account'}</span>
          <span className="text-muted">
            <ChevronIcon size={16} />
          </span>
        </>
      }
    >
      {handle ? (
        <>
          <Link href={`/u/${handle}`} className="menu-item">
            <UserIcon size={18} />
            Profile
          </Link>
          <Link href="/bookmarks" className="menu-item">
            <BookmarkIcon size={18} />
            Bookmarks
          </Link>
          <Link href="/settings" className="menu-item">
            <GearIcon size={18} />
            Settings
          </Link>
          <Link href="/governance" className="menu-item">
            <GovernanceIcon size={18} />
            Governance
          </Link>
          {viewer.state === 'member' && viewer.me.moderates ? (
            <Link href="/mod" className="menu-item">
              <ShieldIcon size={18} />
              Moderation
            </Link>
          ) : null}
          <div className="flex items-center justify-between gap-3 px-3 py-2">
            <span className="text-sm font-medium">Theme</span>
            <ThemeSwitch compact />
          </div>
          <hr className="my-1 border-line" />
        </>
      ) : (
        <p className="px-3 py-2 text-sm text-muted">This account cannot post.</p>
      )}
      {/* A plain link, not a router navigation: Kratos ends the session on this
          request and must receive it exactly once, straight from the browser. */}
      {logoutUrl ? (
        <a href={logoutUrl} className="menu-item menu-item-danger">
          Sign out
        </a>
      ) : null}
    </Menu>
  )
}

export function RightRail() {
  return (
    <aside className="square-rail">
      <TreasuryPreview />
      <Suspense fallback={<div className="skeleton h-72" />}>
        <PopularCommunities />
      </Suspense>

      <section className="rail-section">
        <h2 className="section-title flex items-center gap-2"><VoteIcon size={18} /> Community votes</h2>
        <p className="mt-2 text-[13px] leading-relaxed text-muted">
          A say in our shared future. See what we’re building toward.
        </p>
        <Link href="/governance#votes" className="rail-text-link">
          Explore governance <ArrowUpRightIcon size={16} />
        </Link>
      </section>

      <Suspense fallback={null}>
        <Trending />
      </Suspense>
    </aside>
  )
}

async function PopularCommunities() {
  const [communities, viewer] = await Promise.all([getCommunities(), getViewer()])
  const popular = [...communities].sort((a, b) => b.memberCount - a.memberCount).slice(0, 5)
  if (popular.length === 0) return null

  return (
    <section className="rail-section">
      <div className="flex items-baseline justify-between">
        <h2 className="section-title">Popular communities</h2>
        <Link href="/c" className="text-[13px] font-semibold text-accent-strong hover:underline">
          View all
        </Link>
      </div>
      <ul className="mt-3 flex flex-col gap-2.5">
        {popular.map((c) => (
          <li key={c.slug} className="community-row flex items-center gap-3">
            <Avatar handle={c.name} size={38} />
            <div className="min-w-0 flex-1">
              <Link href={`/c/${c.slug}`} className="block truncate text-sm font-semibold hover:underline">
                {c.name}
              </Link>
              <p className="text-xs text-muted">
                {c.memberCount} {c.memberCount === 1 ? 'member' : 'members'}
              </p>
            </div>
            {viewer.state === 'member' ? <JoinButton slug={c.slug} joined={c.viewerIsMember} compact /> : null}
          </li>
        ))}
      </ul>
    </section>
  )
}

async function Trending() {
  const trending = await getTrending()
  if (trending.length === 0) return null

  return (
    <section className="rail-section">
      <h2 className="section-title flex items-center gap-2">
        <span className="text-warm">
          <FlameIcon size={18} />
        </span>
        Trending conversations
      </h2>
      <ol className="mt-3 flex flex-col gap-3.5">
        {trending.map((post, i) => (
          <li key={post.id} className="flex gap-3">
            <span className="w-4 shrink-0 pt-px text-sm font-bold tabular-nums text-faint">
              {i + 1}
            </span>
            <Link href={`/p/${post.id}`} className="group min-w-0">
              <span className="line-clamp-2 text-sm font-semibold leading-snug group-hover:underline">{post.text}</span>
              <span className="mt-1 block text-xs text-muted">
                {post.replyCount} {post.replyCount === 1 ? 'reply' : 'replies'}, {post.likeCount}{' '}
                {post.likeCount === 1 ? 'like' : 'likes'}
              </span>
            </Link>
          </li>
        ))}
      </ol>
    </section>
  )
}

export function BottomNav() {
  return (
    <nav
      aria-label="Main"
      className="square-bottom-nav fixed inset-x-0 bottom-0 z-20 flex items-center border-t border-line bg-surface px-1 pb-[env(safe-area-inset-bottom)]"
    >
      <Suspense>
        <NavLink href="/" exact className="bottom-tab">
          <HomeIcon size={22} />
          Home
        </NavLink>
        <NavLink href="/c" className="bottom-tab">
          <PeopleIcon size={22} />
          Communities
        </NavLink>
        <Link
          href="/#compose"
          aria-label="New post"
          className="mx-2 flex size-11 shrink-0 items-center justify-center rounded-[10px] bg-accent text-accent-ink transition-transform active:scale-95"
        >
          <PlusIcon size={24} />
        </Link>
        <NotificationsTab />
        <ProfileTab />
      </Suspense>
    </nav>
  )
}

/** Bookmarks for visitors; members get Notifications here (Bookmarks moves to the account menu). */
async function NotificationsTab() {
  const viewer = await getViewer()
  if (viewer.state !== 'member') {
    return (
      <NavLink href="/bookmarks" className="bottom-tab">
        <BookmarkIcon size={22} />
        Bookmarks
      </NavLink>
    )
  }
  return (
    <NavLink href="/notifications" className="bottom-tab">
      <span className="relative">
        <BellIcon size={22} />
        <UnreadBadge count={viewer.me.unreadNotifications} dot />
      </span>
      Notifications
    </NavLink>
  )
}

async function ProfileTab() {
  const viewer = await getViewer()
  const href = viewer.state === 'member' ? `/u/${viewer.me.handle}` : '/login'
  return (
    <NavLink href={href} className="bottom-tab">
      <UserIcon size={22} />
      {viewer.state === 'member' ? 'Profile' : 'Sign in'}
    </NavLink>
  )
}
