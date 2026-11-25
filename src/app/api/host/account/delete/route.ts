import { z } from 'zod'
import { getAuth } from '@/auth/server'
import * as session from '@/auth/session'
import { route } from '@/lib/route'
import { deleteAccount } from '@/modules/events/account'

const body = z.object({ password: z.string().max(200).optional() })

export const POST = route(async (req) => {
  const { password } = body.parse(await req.json())
  const user = await session.requireUser(req.headers)
  const current = await getAuth().api.getSession({ headers: req.headers })
  await deleteAccount(user.id, current?.session.token ?? null, password)
  return Response.json({ ok: true })
})
