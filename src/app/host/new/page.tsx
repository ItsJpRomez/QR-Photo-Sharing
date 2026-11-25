import type { Metadata } from 'next'
import { CreateEvent } from '@/features/host/create-event'

export const metadata: Metadata = { title: 'Create event' }

export default function NewEventPage() {
  return <CreateEvent />
}
