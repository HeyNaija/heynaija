import type { Metadata } from 'next'
import { DeletionPage } from './deletion-page'

export const metadata: Metadata = { title: 'Delete your account' }

export default function DeleteAccountPage({ searchParams }: PageProps<'/settings/delete'>) {
  return <DeletionPage searchParams={searchParams} />
}
