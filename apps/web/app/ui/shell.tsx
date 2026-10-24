import Image from 'next/image'
import Link from 'next/link'
import { type ComponentType, Suspense } from 'react'
import { getCommunities, getTrending, getTrendingTopics, getViewer, type Viewer } from '@/lib/api'
import { getLogoutUrl } from '@/lib/auth/server'
import { Avatar } from './avatar'
import { CommunityMark } from './community-mark'
import {
  ArrowUpRightIcon,
  BellIcon,
  BookmarkIcon,
  ChevronIcon,
  DotsIcon,
  FlameIcon,
  GovernanceIcon,
  GearIcon,
  HashIcon,
  HomeIcon,
  HistoryIcon,
  InfoIcon,
  PeopleIcon,
  SearchIcon,
  ShieldIcon,
  UserIcon,
} from './icons'
import { JoinButton } from './join-button'
import { Logo } from './logo'
import { Menu } from './menu'
import { NavLink } from './nav-link'
import { NewPostLink } from './new-post-link'
import { PushCheck } from './push-check'
import { ThemeSwitch } from './theme-switch'
import { TopicList } from './topic-list'
import { TreasuryPreview } from './treasury-preview'
import { UnreadBadge } from './unread-badge'

type SidebarLink = {
  href: string
  label: string
  icon: ComponentType<{ size?: number }>
  exact?: boolean
  /** Which goes into More first when the window is short: 1 stays out longest. */
  keep: number
  unread?: number
  /** Drawn empty, for its room only (see `sidebarLinks`). */
  placeholder?: boolean
}

/** The member as far as the sidebar can tell: undefined until it is known who is looking. */
type Looking = Extract<Viewer, { state: 'member' }>['me'] | null | undefined

/**
 * How much of the sidebar shows is decided by the window's height, in CSS (see
 * "The sidebar" in globals.css), so it is right on the first paint and with
 * JavaScript off. Each link is also listed in the More menu; the stylesheet shows
 * those copies, and hides the ones in the list, a tier at a time as space runs out.
 * The two least wanted links share the last tier: a More button takes the room of
 * one link, so hiding a single link would gain nothing.
 */
export function Sidebar() {
  return (
    <aside className="square-sidebar">
      <div className="sidebar-brand">
        <Logo />
      </div>

      <div className="sidebar-body">
        {/* Who is looking, and the current page (usePathname), are only known per request,
            hence the boundaries. What they hold is the same for everyone apart from a few
            details, so the links are drawn at once, as plain links, and the real ones
            (highlighting the current page, with the unread count) take their place. */}
        <Suspense fallback={<SidebarLinks links={sidebarLinks(undefined)} known={false} />}>
          <SidebarNav />
        </Suspense>
        <Suspense fallback={<div className="sidebar-compose" aria-hidden="true" />}>
          <SidebarCompose />
        </Suspense>

        <div className="sidebar-card-slot">
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
              <p>Different places.<br />A shared sense of home.</p>
              <p className="mt-2">Made for Nigerians, at home and everywhere. Built toward a community-owned future.</p>
              <Link href="/about" className="ownership-link">Get to know HeyNaija <ArrowUpRightIcon size={14} /></Link>
            </div>
          </div>
          <p className="sidebar-footer">Real people. Real conversations.</p>
        </div>
      </div>
    </aside>
  )
}

/**
 * The links in the order they are drawn; `keep` is the order they are given up in.
 * Which links there are depends on who is looking. Until that is known (`me`
 * undefined) the page is drawn for a member, whose list is the longer: the
 * Notifications row is kept, empty, so nothing below it moves when a member's page
 * fills in. For a visitor that row goes away when it is known they are one.
 */
function sidebarLinks(me: Looking): SidebarLink[] {
  return [
    { href: '/', label: 'Home', icon: HomeIcon, exact: true, keep: 1 },
    { href: '/c', label: 'Communities', icon: PeopleIcon, keep: 2 },
    // Members only, with the unread count.
    ...(me !== null
      ? [{ href: '/notifications', label: 'Notifications', icon: BellIcon, keep: 3, unread: me?.unreadNotifications, placeholder: me === undefined }]
      : []),
    { href: '/about', label: 'About HeyNaija', icon: InfoIcon, keep: 9 },
    { href: '/progress', label: 'Progress', icon: HistoryIcon, keep: 8 },
    { href: '/governance', label: 'Governance', icon: GovernanceIcon, keep: 7 },
    { href: '/bookmarks', label: 'Bookmarks', icon: BookmarkIcon, keep: 5 },
    { href: '/settings', label: 'Settings', icon: GearIcon, keep: 6 },
    // Only moderators see this; the API checks the role again on every request.
    ...(me?.moderates ? [{ href: '/mod', label: 'Moderation', icon: ShieldIcon, keep: 4 }] : []),
  ]
}

async function SidebarNav() {
  const viewer = await getViewer()
  return <SidebarLinks links={sidebarLinks(viewer.state === 'member' ? viewer.me : null)} known />
}

/** A link in the list or in More. Before it is known who is looking (and which page this is), plain links. */
function SidebarLinkItem({ link, known, className, size }: { link: SidebarLink; known: boolean; className: string; size: number }) {
  const { href, label, icon: Icon, exact, unread, placeholder } = link
  const content = (
    <>
      <Icon size={size} />
      {label}
      {unread ? <UnreadBadge count={unread} /> : null}
    </>
  )
  if (placeholder) return <span className={`${className} invisible`} aria-hidden="true">{content}</span>
  return known ? (
    <NavLink href={href} exact={exact} className={className}>{content}</NavLink>
  ) : (
    <Link href={href} className={className}>{content}</Link>
  )
}

function SidebarLinks({ links, known }: { links: SidebarLink[]; known: boolean }) {
  const lastTier = links.length - 1
  const tiers = new Map(
    [...links].sort((a, b) => a.keep - b.keep).map((link, i) => [link.href, Math.min(i + 1, lastTier)]),
  )
  const notifications = links.find((link) => link.unread)

  return (
    <nav aria-label="Main" className="sidebar-nav">
      <p className="sidebar-label">Your space</p>
      <ul className="sidebar-nav-list">
        {links.map((link) => (
          <li key={link.href} data-tier={tiers.get(link.href)}>
            <SidebarLinkItem link={link} known={known} className="sidebar-nav-item" size={20} />
          </li>
        ))}
        <li className="sidebar-more" data-more-tier={lastTier}>
          <Menu
            label="More"
            triggerClassName="sidebar-nav-item"
            panelClassName="sidebar-more-panel"
            trigger={
              <>
                <span className="relative">
                  <DotsIcon />
                  {/* The count is on a link that has moved into this menu. */}
                  {notifications ? (
                    <span className="sidebar-more-dot" data-tier={tiers.get(notifications.href)}>
                      <UnreadBadge count={notifications.unread!} dot />
                    </span>
                  ) : null}
                </span>
                More
              </>
            }
          >
            {links.filter((link) => !link.placeholder).map((link) => (
              <div key={link.href} data-tier={tiers.get(link.href)}>
                <SidebarLinkItem link={link} known={known} className="menu-item" size={18} />
              </div>
            ))}
          </Menu>
        </li>
      </ul>
    </nav>
  )
}

async function SidebarCompose() {
  const viewer = await getViewer()
  return viewer.state === 'member' ? <NewPostLink expanded /> : (
    <Link href="/join" className="btn btn-primary btn-block sidebar-compose">Find your community <ArrowUpRightIcon size={17} /></Link>
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
            placeholder="Search HeyNaija"
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
        {/* Nothing is drawn while the account controls load: they differ in shape (a
            circle for a member, buttons for a visitor), so a skeleton flashed a grey
            circle before it turned into either. On a phone a member's is always 70px
            wide, and that room is kept so the icons beside it do not slide left when it
            arrives. From 640px up its width depends on the handle, and from 1024px
            nothing sits beside it, so nothing is kept. */}
        <Suspense fallback={<span className="block h-[42px] w-[70px] sm:hidden" aria-hidden="true" />}>
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
          Join HeyNaija
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
      panelClassName="account-menu-panel"
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
          {viewer.state === 'member' ? <PushCheck memberId={viewer.me.id} /> : null}
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
          <div className="account-theme">
            <span className="text-xs font-semibold text-muted">Theme</span>
            <ThemeSwitch compact />
          </div>
          <hr className="my-1 border-line" />
        </>
      ) : (
        <p className="px-3 py-2 text-sm text-muted">This account cannot post.</p>
      )}
      <Link href="/about" className="menu-item">
        <InfoIcon size={18} />
        About HeyNaija
      </Link>
      <Link href="/progress" className="menu-item">
        <HistoryIcon size={18} />
        What we’re building
      </Link>
      {/* A plain link, not a router navigation: Kratos ends the session on this
          request and must receive it exactly once, straight from the browser.
          /logout drops the API's cached session first, then redirects there. */}
      {logoutUrl ? (
        <a href={`/logout?to=${encodeURIComponent(logoutUrl)}`} className="menu-item menu-item-danger">
          Sign out
        </a>
      ) : null}
    </Menu>
  )
}

export function RightRail() {
  return (
    <aside className="square-rail">
      <div className="rail-heading"><span className="page-eyebrow">A little more connected</span><h2>Discover your people</h2></div>
      <Suspense fallback={<div className="skeleton h-72" />}>
        <PopularCommunities />
      </Suspense>
      <Suspense fallback={null}>
        <TrendingTopics />
      </Suspense>
      <Suspense fallback={null}>
        <Trending />
      </Suspense>
      <TreasuryPreview />
      <p className="rail-footer">A space for us. A future we build together.<br /><Link href="/about">About HeyNaija</Link><span aria-hidden="true"> · </span><Link href="/c">Our communities</Link><br /><Link href="/rules">Rules</Link><span aria-hidden="true"> · </span><Link href="/privacy">Privacy</Link><span aria-hidden="true"> · </span><Link href="/charter">Charter</Link><span aria-hidden="true"> · </span><Link href="/licence">Licence</Link></p>
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
        <h2 className="section-title">Find your community</h2>
        <Link href="/c" className="text-[13px] font-semibold text-accent-strong hover:underline">
          View all
        </Link>
      </div>
      <ul className="community-rail-list">
        {popular.map((c) => (
          <li key={c.slug} className="community-row flex items-center gap-3">
            <Link href={`/c/${c.slug}`} tabIndex={-1} aria-hidden="true"><CommunityMark slug={c.slug} /></Link>
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

async function TrendingTopics() {
  // Something extra beside the page: if it cannot be read, the page goes on without it.
  const trending = await getTrendingTopics().catch(() => null)
  if (!trending?.topics.length) return null
  const { topics, rules } = trending

  return (
    <section className="rail-section">
      <div className="flex items-baseline justify-between">
        <h2 className="section-title flex items-center gap-2">
          <span className="text-accent-strong">
            <HashIcon size={18} />
          </span>
          Trending topics
        </h2>
        <Link href="/topics" className="text-[13px] font-semibold text-accent-strong hover:underline">
          How they’re chosen
        </Link>
      </div>
      <TopicList topics={topics.slice(0, 5)} rules={rules} compact />
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
            <span className="w-4 shrink-0 pt-px text-sm font-bold tabular-nums text-muted">
              {i + 1}
            </span>
            <Link href={`/p/${post.id}`} className="group min-w-0">
              <span className="line-clamp-2 text-[13px] font-semibold leading-relaxed group-hover:underline">{post.text || 'A conversation in pictures'}</span>
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
          Explore
        </NavLink>
        <NewPostTab />
        <NotificationsTab />
        <ProfileTab />
      </Suspense>
    </nav>
  )
}

/** Only members can post, so visitors get no "New post" button to a box that is not there. */
async function NewPostTab() {
  const viewer = await getViewer()
  return viewer.state === 'member' ? <NewPostLink /> : null
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
