import { z } from 'zod'
import { guestRoute } from '@/lib/guest-route'
import { requireUuid } from '@/lib/host-route'
import { deleteComment, hideComment } from '@/modules/social/comments'

type P = { code: string; commentId: string }
const body = z.object({ hidden: z.boolean() })

export const DELETE = guestRoute<P>(async (_req, { params, event, viewer }) => {
  await deleteComment(viewer, event, requireUuid(params.commentId))
  return Response.json({ ok: true })
})

export const PATCH = guestRoute<P>(async (req, { params, event, viewer }) => {
  await hideComment(viewer, event, requireUuid(params.commentId), body.parse(await req.json()).hidden)
  return Response.json({ ok: true })
})
