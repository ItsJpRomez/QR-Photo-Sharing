import { guestRoute } from '@/lib/guest-route'
import { requireUuid } from '@/lib/host-route'
import { addComment, commentInput, listComments } from '@/modules/social/comments'

type P = { code: string; photoId: string }

export const GET = guestRoute<P>(async (req, { params, event, viewer }) =>
  Response.json(await listComments(viewer, event, requireUuid(params.photoId), new URL(req.url).searchParams.get('cursor'))),
)

export const POST = guestRoute<P>(async (req, { params, event, viewer }) =>
  Response.json(await addComment(viewer, event, requireUuid(params.photoId), commentInput.parse(await req.json())), { status: 201 }),
)
