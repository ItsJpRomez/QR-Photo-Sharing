import * as session from '@/auth/session'
import type { EventRow } from '@/db/schema'
import { requireOwnedEvent } from '@/modules/access/viewer'
import { AppError } from './errors'
import { route, type RouteHandler } from './route'

type Params = Record<string, string>
type Extra<P> = { params: P; event: EventRow; user: session.SessionUser }

/** A route for the event's owner. Anyone else is told it doesn't exist. */
export function hostRoute<P extends Params & { id: string }>(
  fn: (req: Request, extra: Extra<P>) => Promise<Response>,
  o: { includeDeleted?: boolean } = {},
): RouteHandler<P> {
  return route<P>(async (req, ctx) => {
    const params = await ctx.params
    const user = await session.requireUser(req.headers)
    return fn(req, { params, user, event: await requireOwnedEvent(user.id, params.id, o) })
  })
}

export function requireUuid(id: string): string {
  if (!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(id)) throw new AppError('not_found')
  return id
}
