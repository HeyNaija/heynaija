import { Logo } from '@/app/ui/logo'

// Sign-in and sign-up: one quiet column, nothing to distract.
export default function AuthLayout({ children }: LayoutProps<'/'>) {
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col px-4 py-8 sm:py-14">
      <header className="flex justify-center">
        <Logo size={36} />
      </header>
      <main className="square-card mt-6 p-6 sm:p-8">{children}</main>
    </div>
  )
}
