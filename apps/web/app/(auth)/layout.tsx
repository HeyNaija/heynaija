import Link from 'next/link'
import { ArrowUpRightIcon, BubbleIcon, PeopleIcon, ShieldIcon } from '@/app/ui/icons'
import { Logo } from '@/app/ui/logo'

const highlights = [
  {
    Icon: PeopleIcon,
    title: 'Find your corner',
    detail: 'Communities for your city, interests and everyday life.',
  },
  {
    Icon: BubbleIcon,
    title: 'Keep up, in order',
    detail: 'Chronological conversations, with a reason behind every post in your feed.',
  },
  {
    Icon: ShieldIcon,
    title: 'See how decisions are made',
    detail: 'Clear community rules, and a permanent record of every moderation decision.',
  },
]

export default function AuthLayout({ children }: LayoutProps<'/'>) {
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-6xl flex-col px-5 py-6 sm:px-8 lg:py-9">
      <header className="flex items-center justify-between gap-4">
        <Logo size={32} />
        <Link href="/" className="btn btn-ghost gap-2 px-2 text-sm">
          <span>Explore<span className="hidden sm:inline"> the feed</span></span> <ArrowUpRightIcon size={16} />
        </Link>
      </header>
      <main className="grid flex-1 items-center gap-12 py-8 sm:py-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,440px)] lg:gap-20 lg:py-16">
        <section className="hidden max-w-lg lg:block" aria-labelledby="auth-welcome">
          <p className="text-xs font-bold tracking-[0.14em] text-accent-strong uppercase">Nigeria, in conversation</p>
          <h2 id="auth-welcome" className="mt-5 text-[42px] leading-[1.18] font-bold tracking-[-0.04em] text-brand-deep">
            A little closer to home.
          </h2>
          <p className="mt-5 max-w-md text-base leading-7 text-muted">
            Your city. Your interests. Your point of view. A place for Nigerians at home and around the world to connect.
          </p>
          <div className="mt-10 flex flex-col gap-6">
            {highlights.map(({ Icon, title, detail }) => (
              <div key={title} className="flex items-start gap-4">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-line bg-surface text-accent-strong">
                  <Icon size={20} />
                </span>
                <div>
                  <h3 className="text-sm font-bold">{title}</h3>
                  <p className="mt-1 max-w-sm text-sm leading-relaxed text-muted">{detail}</p>
                </div>
              </div>
            ))}
          </div>
        </section>
        <div className="square-card mx-auto w-full max-w-md p-6 sm:p-9">{children}</div>
      </main>
      <footer className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2 pb-2 text-xs leading-relaxed text-muted lg:justify-between">
        <span>A Nigeria-first discussion network.</span>
        <nav aria-label="About HeyNaija" className="flex flex-wrap justify-center gap-x-5 gap-y-2">
          <Link href="/about" className="font-medium hover:text-accent-strong hover:underline">About HeyNaija</Link>
          <Link href="/progress" className="font-medium hover:text-accent-strong hover:underline">Progress</Link>
          <Link href="/governance" className="font-medium hover:text-accent-strong hover:underline">Our direction &amp; governance</Link>
        </nav>
      </footer>
    </div>
  )
}
