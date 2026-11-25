import * as session from '@/auth/session'
import type { EventRow } from '@/db/schema'
import type { Viewer } from '@/modules/access/can'
import { hostParticipant, requireOwnedEvent } from '@/modules/access/viewer'
import { AppError } from './errors'
import { route, type RouteHandler } from './route'

type Params = Record<string, string>
type Extra<P> = { params: P; event: EventRow; user: session.SessionUser; viewer: Extract<Viewer, { kind: 'host' }> }

/** A route for the event's owner. Anyone else is told it doesn't exist. */
export function hostRoute<P extends Params & { id: string }>(
  fn: (req: Request, extra: Extra<P>) => Promise<Response>,
  o: { includeDeleted?: boolean } = {},
): RouteHandler<P> {
  return route<P>(async (req, ctx) => {
    const params = await ctx.params
    const user = await session.requireUser(req.headers)
    const event = await requireOwnedEvent(user.id, params.id, o)
    const me = await hostParticipant(event, user)
    return fn(req, { params, user, event, viewer: { kind: 'host', eventId: event.id, participantId: me.id, userId: user.id } })
  })
}

export function requireUuid(id: string): string {
  if (!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(id)) throw new AppError('not_found')
  return id
}
