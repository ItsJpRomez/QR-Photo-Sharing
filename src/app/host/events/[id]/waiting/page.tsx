import type { Metadata } from 'next'
import { HostPhotos } from '@/features/host/host-photos'

export const metadata: Metadata = { title: 'Waiting photos' }

export default async function WaitingPage({ params }: { params: Promise<{ id: string }> }) {
  return <HostPhotos id={(await params).id} waiting />
}
