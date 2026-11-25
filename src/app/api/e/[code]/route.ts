import { route } from '@/lib/route'
import { resolveViewer } from '@/modules/access/viewer'
import { lockedEvent, openEvent } from '@/modules/events/view'

export const GET = route<{ code: string }>(async (req, { params }) => {
  const { event, viewer, me } = await resolveViewer({ code: (await params).code }, req)
  if (viewer.kind === 'locked' || !me) return Response.json(await lockedEvent(event))
  return Response.json(await openEvent(event, viewer, me))
})
