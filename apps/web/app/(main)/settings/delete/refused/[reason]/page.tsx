import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { REFUSALS, type Refusal } from '@/lib/account-deletion'
import { DeletionPage } from '../../deletion-page'

export const metadata: Metadata = { title: 'Delete your account' }

// Where a browser without JavaScript lands when a request is refused: the page
// with the message above the form, prerendered for each reason. Cache Components
// does not allow `dynamicParams = false`, so params are awaited outside any
// <Suspense> (keeping the route static) and any other reason is a 404.
export function generateStaticParams() {
  return Object.keys(REFUSALS).map((reason) => ({ reason }))
}

export default async function RefusedDeletionPage({ params }: PageProps<'/settings/delete/refused/[reason]'>) {
  const { reason } = await params
  if (!Object.hasOwn(REFUSALS, reason)) notFound()
  return <DeletionPage refusal={reason as Refusal} />
}
