import { z } from 'zod'
import { hostRoute, requireUuid } from '@/lib/host-route'
import { blockTag, listAllTags, unsuggestTag } from '@/modules/events/tags'

const body = z.union([z.object({ blocked: z.literal(true) }), z.object({ suggested: z.literal(false) })])

export const PATCH = hostRoute<{ id: string; tagId: string }>(async (req, { event, params }) => {
  const change = body.parse(await req.json())
  const id = requireUuid(params.tagId)
  if ('blocked' in change) await blockTag(event.id, id)
  else await unsuggestTag(event.id, id)
  return Response.json({ tags: await listAllTags(event.id) })
})
