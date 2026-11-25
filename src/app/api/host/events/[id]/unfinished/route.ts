import { hostRoute } from '@/lib/host-route'
import { clearUnfinished, unfinishedUploads } from '@/modules/photos/uploads'

type P = { id: string }

export const GET = hostRoute<P>(async (_req, { event }) => Response.json(await unfinishedUploads(event.id)))

export const DELETE = hostRoute<P>(async (_req, { event }) => Response.json(await clearUnfinished(event.id)))
