import { z } from 'zod'
import { hostRoute } from '@/lib/host-route'
import { listAlbums, reorderAlbums } from '@/modules/events/albums'

const body = z.object({ ids: z.array(z.uuid()).max(100) })

export const PUT = hostRoute<{ id: string }>(async (req, { event }) => {
  await reorderAlbums(event.id, body.parse(await req.json()).ids)
  return Response.json({ albums: await listAlbums(event.id) })
})
