import { z } from 'zod'
import { hostRoute } from '@/lib/host-route'
import { hostEvent } from '@/modules/events/events'
import { pin } from '@/modules/events/input'
import { setTvPin } from '@/modules/tv/tv'

const body = z.discriminatedUnion('show', [z.object({ show: z.literal(true), pin }), z.object({ show: z.literal(false) })])

export const PUT = hostRoute<{ id: string }>(async (req, { event }) =>
  Response.json(await hostEvent(await setTvPin(event, body.parse(await req.json())))),
)
