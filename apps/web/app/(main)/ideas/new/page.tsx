import type { Metadata } from 'next'
import Link from 'next/link'
import { Suspense } from 'react'
import { IdeaForm } from '@/app/ui/idea-form'
import { PostsSkeleton } from '@/app/ui/post-item'
import { getViewer } from '@/lib/api'

export const metadata: Metadata = { title: 'Suggest an idea or report a problem' }

const one = (value: string | string[] | undefined) => (typeof value === 'string' ? value : undefined)

export default function NewIdeaPage({ searchParams }: PageProps<'/ideas/new'>) {
  return (
    <div className="page-stack">
      <header className="page-intro">
        <p className="page-eyebrow">
          <Link href="/ideas" className="hover:underline">Ideas and problems</Link>
        </p>
        <h1 className="page-title">Tell us what would make HeyNaija better</h1>
        <p className="page-description">
          An idea for something new, or a problem with what is there. It goes on the board for others to vote on, and you
          are told when its status changes.
        </p>
      </header>
      <Suspense fallback={<PostsSkeleton />}>
        <Form searchParams={searchParams} />
      </Suspense>
    </div>
  )
}

async function Form({ searchParams }: Pick<PageProps<'/ideas/new'>, 'searchParams'>) {
  const [params, viewer] = await Promise.all([searchParams, getViewer()])
  if (viewer.state !== 'member') {
    return (
      <p className="notice">
        <Link href="/login" className="font-semibold underline underline-offset-2">Sign in</Link> to suggest an idea or
        report a problem. You can read and follow the <Link href="/ideas" className="underline">board</Link> without an account.
      </p>
    )
  }
  // Only a path on this site counts as where a problem happened.
  const from = one(params.from)
  const page = from?.startsWith('/') && !from.startsWith('//') ? from.slice(0, 500) : null
  return <IdeaForm kind={one(params.kind) === 'problem' ? 'problem' : 'idea'} from={page} />
}
