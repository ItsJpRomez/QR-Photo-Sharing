import { guestRoute } from '@/lib/guest-route'
import { requireUuid } from '@/lib/host-route'
import { deleteOwnPhoto, moderate } from '@/modules/photos/moderation'

export const DELETE = guestRoute<{ code: string; photoId: string }>(async (_req, { params, event, viewer }) => {
  const id = requireUuid(params.photoId)
  if (viewer.kind === 'host') await moderate(viewer, event, [id], { kind: 'delete' })
  else await deleteOwnPhoto(viewer, event, id)
  return Response.json({ ok: true })
})
