'use client'

import { ApiError } from '@/lib/api'
import { useRunQueue } from '@/features/upload-queue/use-queue'
import { Gallery } from './gallery'
import { LinkChanged } from './link-changed'
import { PinScreen } from './pin-screen'
import { useEvent, type EventDto } from './queries'

export function EventScreen({ code, initial }: { code: string; initial: EventDto }) {
  useRunQueue()
  const { data: event, error } = useEvent(code, initial)
  if (error instanceof ApiError && error.code === 'not_found') return <LinkChanged />
  return event.pinRequired ? <PinScreen code={code} event={event} /> : <Gallery event={event} />
}
