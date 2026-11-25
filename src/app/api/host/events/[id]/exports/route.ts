import { z } from 'zod'
import { hostRoute } from '@/lib/host-route'
import { listExports, startExport, toDto } from '@/modules/exports/build'

type P = { id: string }
const body = z.object({ includeHidden: z.boolean(), includePending: z.boolean() })

export const GET = hostRoute<P>(async (_req, { event }) => Response.json({ exports: (await listExports(event)).map(toDto) }))

export const POST = hostRoute<P>(async (req, { event, viewer }) =>
  Response.json(toDto(await startExport(viewer, event, body.parse(await req.json()))), { status: 201 }),
)
