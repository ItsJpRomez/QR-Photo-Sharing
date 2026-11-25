import { z } from 'zod'
import { clientIp } from '@/lib/ip'
import { route } from '@/lib/route'
import { requireCan } from '@/modules/access/can'
import { resolveViewer } from '@/modules/access/viewer'
import { reserveInput, reserveUpload, uploadStates } from '@/modules/photos/uploads'

type P = { code: string }
const ids = z.array(z.uuid()).max(100)

export const POST = route<P>(async (req, { params }) => {
  const input = reserveInput.parse(await req.json())
  const { event, viewer } = await resolveViewer({ code: (await params).code }, req)
  requireCan(viewer, 'gallery.view', { event })
  return Response.json(await reserveUpload(viewer, event, input, clientIp(req.headers)))
})

export const GET = route<P>(async (req, { params }) => {
  const list = ids.parse((new URL(req.url).searchParams.get('ids') ?? '').split(',').filter(Boolean))
  const { event, viewer } = await resolveViewer({ code: (await params).code }, req)
  requireCan(viewer, 'gallery.view', { event })
  return Response.json({ states: await uploadStates(viewer, event, list) })
})
