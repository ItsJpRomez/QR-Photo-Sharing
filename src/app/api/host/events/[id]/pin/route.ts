import { z } from 'zod'
import { db } from '@/db/client'
import { hostRoute } from '@/lib/host-route'
import { pin } from '@/modules/events/input'
import { setPin } from '@/modules/events/pin'

const body = z.object({ pin: pin.nullable() })

export const PUT = hostRoute<{ id: string }>(async (req, { event }) => {
  const { pin } = body.parse(await req.json())
  await setPin(db, event.id, pin)
  return Response.json({ hasPin: pin !== null })
})
