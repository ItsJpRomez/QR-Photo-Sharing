import { AppError } from '@/lib/errors'
import * as self from './session'
import { getAuth } from './server'

export type SessionUser = { id: string; email: string; name: string; emailVerified: boolean }

export async function getUser(headers: Headers): Promise<SessionUser | null> {
  if (!headers.get('cookie')) return null
  const s = await getAuth().api.getSession({ headers })
  return s ? { id: s.user.id, email: s.user.email, name: s.user.name, emailVerified: s.user.emailVerified } : null
}

/** The signed-in host, with a confirmed email address. */
export async function requireUser(headers: Headers): Promise<SessionUser> {
  const user = await self.getUser(headers)
  if (!user) throw new AppError('unauthenticated')
  if (!user.emailVerified) throw new AppError('unverified')
  return user
}
