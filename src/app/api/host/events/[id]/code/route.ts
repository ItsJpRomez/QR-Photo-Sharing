import { hostRoute } from '@/lib/host-route'
import { hostEvent, replaceCode } from '@/modules/events/events'

export const POST = hostRoute<{ id: string }>(async (_req, { event }) => Response.json(await hostEvent(await replaceCode(event.id))))
