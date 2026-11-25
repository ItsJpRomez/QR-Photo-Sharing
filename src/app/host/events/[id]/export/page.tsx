import type { Metadata } from 'next'
import { ExportPage } from '@/features/host/export'

export const metadata: Metadata = { title: 'Download photos' }

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  return <ExportPage id={(await params).id} />
}
