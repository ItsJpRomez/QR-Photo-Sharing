import type { EventRow } from '@/db/schema'
import { requireCan, type Viewer } from '@/modules/access/can'
import { resolveViewer } from '@/modules/access/viewer'
import { route, type RouteHandler } from './route'

type Extra<P> = { params: P; event: EventRow; viewer: Exclude<Viewer, { kind: 'locked' }> }

/** A route for anyone who is inside the event: a guest past the PIN, or the host. */
export function guestRoute<P extends { code: string } & Record<string, string>>(
  fn: (req: Request, extra: Extra<P>) => Promise<Response>,
): RouteHandler<P> {
  return route<P>(async (req, ctx) => {
    const params = await ctx.params
    const { event, viewer } = await resolveViewer({ code: params.code }, req)
    requireCan(viewer, 'gallery.view', { event })
    return fn(req, { params, event, viewer })
  })
}
