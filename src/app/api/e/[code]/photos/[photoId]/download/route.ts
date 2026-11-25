import { requireUuid } from '@/lib/host-route'
import { route } from '@/lib/route'
import { requireCan } from '@/modules/access/can'
import { resolveViewer } from '@/modules/access/viewer'
import { downloadUrl } from '@/modules/photos/downloads'

export const GET = route<{ code: string; photoId: string }>(async (req, { params }) => {
  const { code, photoId } = await params
  const { event, viewer } = await resolveViewer({ code }, req)
  requireCan(viewer, 'gallery.view', { event })
  const original = new URL(req.url).searchParams.get('original') === '1'
  return Response.json({ url: await downloadUrl(viewer, event, requireUuid(photoId), { original }) })
})
