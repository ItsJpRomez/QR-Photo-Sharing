import type { Metadata } from 'next'
import { Share } from '@/features/host/share'

export const metadata: Metadata = { title: 'Share' }

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  return <Share id={(await params).id} />
}
