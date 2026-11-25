import { z } from 'zod'
import { AppError } from '@/lib/errors'
import { route } from '@/lib/route'
import { requireCan } from '@/modules/access/can'
import { resolveViewer } from '@/modules/access/viewer'
import { getPhotos, listPhotos, parseView } from '@/modules/photos/query'

const order = z.enum(['newest', 'taken', 'featured']).optional()
const ids = z.array(z.uuid()).max(100)

export const GET = route<{ code: string }>(async (req, { params }) => {
  const q = new URL(req.url).searchParams
  const { event, viewer } = await resolveViewer({ code: (await params).code }, req)
  requireCan(viewer, 'gallery.view', { event })

  const wanted = q.get('ids')
  if (wanted !== null) return Response.json(await getPhotos(viewer, event, ids.parse(wanted.split(',').filter(Boolean))))

  const view = parseView(q.get('view') ?? '')
  if (!view) throw new AppError('bad_input')
  return Response.json(await listPhotos(viewer, event, { view, order: order.parse(q.get('order') ?? undefined), cursor: q.get('cursor') }))
})
