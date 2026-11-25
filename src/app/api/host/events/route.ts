import * as session from '@/auth/session'
import { route } from '@/lib/route'
import { createEvent, hostEvent, listEvents } from '@/modules/events/events'
import { eventInput } from '@/modules/events/input'

export const GET = route(async (req) => {
  const user = await session.requireUser(req.headers)
  return Response.json({ events: await Promise.all((await listEvents(user.id)).map(hostEvent)) })
})

export const POST = route(async (req) => {
  const user = await session.requireUser(req.headers)
  const event = await createEvent(user.id, eventInput.parse(await req.json()))
  return Response.json(await hostEvent(event), { status: 201 })
})
