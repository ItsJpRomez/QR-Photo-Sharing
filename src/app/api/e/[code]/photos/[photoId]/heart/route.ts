import { z } from 'zod'
import { guestRoute } from '@/lib/guest-route'
import { requireUuid } from '@/lib/host-route'
import { setHeart } from '@/modules/social/hearts'

const body = z.object({ on: z.boolean() })

export const PUT = guestRoute<{ code: string; photoId: string }>(async (req, { params, event, viewer }) => {
  const { on } = body.parse(await req.json())
  return Response.json(await setHeart(viewer, event, requireUuid(params.photoId), on))
})
