import { z } from 'zod'
import { clientIp } from '@/lib/ip'
import { route } from '@/lib/route'
import { resolveViewer } from '@/modules/access/viewer'
import { PIN_FORMAT, tryPin } from '@/modules/events/pin'

const body = z.object({ pin: z.string().regex(PIN_FORMAT) })

export const POST = route<{ code: string }>(async (req, { params }) => {
  const { pin } = body.parse(await req.json())
  const { event, viewer, tokenHash } = await resolveViewer({ code: (await params).code }, req)
  if (viewer.kind === 'locked' && tokenHash) await tryPin(event, tokenHash, clientIp(req.headers), pin)
  return Response.json({ ok: true })
})
