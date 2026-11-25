import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '@/db/client'
import { participants } from '@/db/schema'
import { route } from '@/lib/route'
import { personName } from '@/lib/text'
import { requireCan } from '@/modules/access/can'
import { resolveViewer } from '@/modules/access/viewer'

const body = z.object({ name: personName })

export const PATCH = route<{ code: string }>(async (req, { params }) => {
  const { name } = body.parse(await req.json())
  const { event, viewer } = await resolveViewer({ code: (await params).code }, req)
  requireCan(viewer, 'gallery.view', { event })
  await db.update(participants).set({ name }).where(eq(participants.id, viewer.participantId))
  return Response.json({ name })
})
