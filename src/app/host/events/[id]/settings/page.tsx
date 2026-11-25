import type { Metadata } from 'next'
import { Settings } from '@/features/host/settings'

export const metadata: Metadata = { title: 'Settings' }

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  return <Settings id={(await params).id} />
}
