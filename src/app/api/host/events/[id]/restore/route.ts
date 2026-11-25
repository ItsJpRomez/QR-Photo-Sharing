import { hostRoute } from '@/lib/host-route'
import { hostEvent, restoreEvent } from '@/modules/events/events'

export const POST = hostRoute<{ id: string }>(
  async (_req, { event, user }) => Response.json(await hostEvent(await restoreEvent(user.id, event.id))),
  { includeDeleted: true },
)
