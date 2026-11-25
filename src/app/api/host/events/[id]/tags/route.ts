import { z } from 'zod'
import { hostRoute } from '@/lib/host-route'
import { listAllTags, suggestTag } from '@/modules/events/tags'

type P = { id: string }
const body = z.object({ tag: z.string().max(100) })

export const GET = hostRoute<P>(async (_req, { event }) => Response.json({ tags: await listAllTags(event.id) }))

export const POST = hostRoute<P>(async (req, { event }) =>
  Response.json(await suggestTag(event.id, body.parse(await req.json()).tag), { status: 201 }),
)
