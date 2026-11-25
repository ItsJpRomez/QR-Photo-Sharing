import { hostRoute } from '@/lib/host-route'
import { approveAll } from '@/modules/photos/moderation'

export const POST = hostRoute<{ id: string }>(async (_req, { event, viewer }) => Response.json(await approveAll(viewer, event)))
