import { hostRoute } from '@/lib/host-route'
import { deleteEvent, hostEvent, updateEvent } from '@/modules/events/events'
import { eventPatch } from '@/modules/events/input'

type P = { id: string }

export const GET = hostRoute<P>(async (_req, { event }) => Response.json(await hostEvent(event)))

export const PATCH = hostRoute<P>(async (req, { event }) =>
  Response.json(await hostEvent(await updateEvent(event.id, eventPatch.parse(await req.json())))),
)

export const DELETE = hostRoute<P>(async (_req, { event }) => {
  await deleteEvent(event.id)
  return Response.json({ ok: true })
})
