import { z } from 'zod'
import { hostRoute } from '@/lib/host-route'
import { createAlbum, listAlbums } from '@/modules/events/albums'
import { albumName } from '@/modules/events/input'

type P = { id: string }
const body = z.object({ name: albumName })

export const GET = hostRoute<P>(async (_req, { event }) => Response.json({ albums: await listAlbums(event.id) }))

export const POST = hostRoute<P>(async (req, { event }) =>
  Response.json(await createAlbum(event.id, body.parse(await req.json()).name), { status: 201 }),
)
