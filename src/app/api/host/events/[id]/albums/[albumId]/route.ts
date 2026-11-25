import { z } from 'zod'
import { hostRoute, requireUuid } from '@/lib/host-route'
import { deleteAlbum, renameAlbum } from '@/modules/events/albums'
import { albumName } from '@/modules/events/input'

type P = { id: string; albumId: string }
const body = z.object({ name: albumName })

export const PATCH = hostRoute<P>(async (req, { event, params }) =>
  Response.json(await renameAlbum(event.id, requireUuid(params.albumId), body.parse(await req.json()).name)),
)

export const DELETE = hostRoute<P>(async (_req, { event, params }) => {
  await deleteAlbum(event.id, requireUuid(params.albumId))
  return Response.json({ ok: true })
})
