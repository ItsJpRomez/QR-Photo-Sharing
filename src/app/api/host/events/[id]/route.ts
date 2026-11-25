import { hostRoute } from '@/lib/host-route'
import { hostEvent, updateEvent } from '@/modules/events/events'
import { eventPatch } from '@/modules/events/input'

type P = { id: string }

export const GET = hostRoute<P>(async (_req, { event }) => Response.json(await hostEvent(event)))

export const PATCH = hostRoute<P>(async (req, { event }) =>
  Response.json(await hostEvent(await updateEvent(event.id, eventPatch.parse(await req.json())))),
)
