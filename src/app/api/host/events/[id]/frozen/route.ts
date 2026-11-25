import { z } from 'zod'
import { hostRoute } from '@/lib/host-route'
import { hostEvent, setFrozen } from '@/modules/events/events'

const body = z.object({ frozen: z.boolean() })

export const PUT = hostRoute<{ id: string }>(async (req, { event }) =>
  Response.json(await hostEvent(await setFrozen(event.id, body.parse(await req.json()).frozen))),
)
