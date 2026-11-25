import { requireUuid } from '@/lib/host-route'
import { route } from '@/lib/route'
import { requireCan } from '@/modules/access/can'
import { resolveViewer } from '@/modules/access/viewer'
import { completeUpload } from '@/modules/photos/uploads'

export const POST = route<{ code: string; photoId: string }>(async (req, { params }) => {
  const { code, photoId } = await params
  const { event, viewer } = await resolveViewer({ code }, req)
  requireCan(viewer, 'gallery.view', { event })
  return Response.json(await completeUpload(viewer, event, requireUuid(photoId)))
})
