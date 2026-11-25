import type { Metadata } from 'next'
import { Dashboard } from '@/features/host/dashboard'

export const metadata: Metadata = { title: 'Your events' }

export default function HostPage() {
  return <Dashboard />
}
