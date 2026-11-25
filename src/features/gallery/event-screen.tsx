'use client'

import { Gallery } from './gallery'
import { PinScreen } from './pin-screen'
import { useEvent, type EventDto } from './queries'

export function EventScreen({ code, initial }: { code: string; initial: EventDto }) {
  const { data: event } = useEvent(code, initial)
  return event.pinRequired ? <PinScreen code={code} event={event} /> : <Gallery event={event} />
}
