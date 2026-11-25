import { route } from '@/lib/route'
import { requireCan } from '@/modules/access/can'
import { resolveViewer } from '@/modules/access/viewer'
import { trendingTags } from '@/modules/events/tags'

export const GET = route<{ code: string }>(async (req, { params }) => {
  const { event, viewer } = await resolveViewer({ code: (await params).code }, req)
  requireCan(viewer, 'gallery.view', { event })
  return Response.json({ trending: await trendingTags(event.id, new Date()) })
})
