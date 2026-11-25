import type { Metadata } from 'next'
import { Organize } from '@/features/host/organize'

export const metadata: Metadata = { title: 'Albums and tags' }

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  return <Organize id={(await params).id} />
}
