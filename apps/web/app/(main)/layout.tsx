import { BottomNav, RightRail, Sidebar, TopBar } from '@/app/ui/shell'

// The app proper: navigation on the left, the page in the middle, discovery on the
// right. On a phone only the middle column shows, with a bar along the bottom.
export default function MainLayout({ children }: LayoutProps<'/'>) {
  return (
    <div className="town-square">
      <a href="#main-content" className="skip-link">
        Skip to content
      </a>
      <Sidebar />
      <div className="square-content">
        <TopBar />
        <div className="square-columns">
          <main id="main-content" className="square-feed">{children}</main>
          <RightRail />
        </div>
      </div>
      <BottomNav />
    </div>
  )
}
