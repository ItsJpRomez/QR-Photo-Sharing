import { z } from 'zod'
import { hostRoute, requireUuid } from '@/lib/host-route'
import { coverState, createCoverUpload, queueCover, removeCover } from '@/modules/events/cover'
import { hostEvent } from '@/modules/events/events'

type P = { id: string }
const start = z.object({ size: z.number().int().positive(), mime: z.string().max(100) })
const finish = z.object({ uploadId: z.string().max(100) })

export const POST = hostRoute<P>(async (req, { event }) => Response.json(await createCoverUpload(event, start.parse(await req.json()))))

export const PUT = hostRoute<P>(async (req, { event }) =>
  Response.json({ job: await queueCover(event, finish.parse(await req.json()).uploadId) }, { status: 202 }),
)

export const GET = hostRoute<P>(async (req, { event }) =>
  Response.json(await coverState(event, requireUuid(new URL(req.url).searchParams.get('job') ?? ''))),
)

export const DELETE = hostRoute<P>(async (_req, { event }) => Response.json(await hostEvent(await removeCover(event))))
