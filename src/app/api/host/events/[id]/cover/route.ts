import { z } from 'zod'
import { hostRoute } from '@/lib/host-route'
import { createCoverUpload, finishCover, removeCover } from '@/modules/events/cover'
import { hostEvent } from '@/modules/events/events'

type P = { id: string }
const start = z.object({ size: z.number().int().positive(), mime: z.string().max(100) })
const finish = z.object({ uploadId: z.string().max(100) })

export const POST = hostRoute<P>(async (req, { event }) => Response.json(await createCoverUpload(event, start.parse(await req.json()))))

export const PUT = hostRoute<P>(async (req, { event }) =>
  Response.json(await hostEvent(await finishCover(event, finish.parse(await req.json()).uploadId))),
)

export const DELETE = hostRoute<P>(async (_req, { event }) => Response.json(await hostEvent(await removeCover(event))))
