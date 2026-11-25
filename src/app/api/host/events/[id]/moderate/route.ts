import { z } from 'zod'
import { hostRoute } from '@/lib/host-route'
import { moderate } from '@/modules/photos/moderation'

const body = z.object({
  ids: z.array(z.uuid()).max(500),
  op: z.discriminatedUnion('kind', [
    z.object({ kind: z.enum(['approve', 'hide', 'unhide', 'delete', 'feature', 'unfeature']) }),
    z.object({ kind: z.literal('move'), albumId: z.uuid().nullable() }),
  ]),
})

export const POST = hostRoute<{ id: string }>(async (req, { event, viewer }) => {
  const { ids, op } = body.parse(await req.json())
  return Response.json(await moderate(viewer, event, ids, op))
})
