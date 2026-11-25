import { and, eq, isNull } from 'drizzle-orm'
import { getAuth } from '@/auth/server'
import { account, session as sessions, user } from '@/db/auth-schema'
import { db, withTx } from '@/db/client'
import { events } from '@/db/schema'
import { AppError } from '@/lib/errors'
import { hitLimit } from '@/lib/rate-limit'
import { publish } from '@/modules/live/publish'

const FRESH_MS = 10 * 60_000

/** The password, or for accounts without one, a sign-in from the last ten minutes. */
async function requireProof(userId: string, sessionToken: string | null, password: string | undefined): Promise<void> {
  const [own] = await db
    .select({ hash: account.password })
    .from(account)
    .where(and(eq(account.userId, userId), eq(account.providerId, 'credential')))
  if (own?.hash) {
    if (!(await hitLimit(`delete-account:${userId}`, 5, 15 * 60))) throw new AppError('rate_limited')
    const { password: hasher } = await getAuth().$context
    if (password && (await hasher.verify({ hash: own.hash, password }))) return
    throw new AppError('forbidden', "That password isn't right.")
  }
  const [s] = sessionToken ? await db.select().from(sessions).where(eq(sessions.token, sessionToken)) : []
  if (!s || Date.now() - s.createdAt.getTime() > FRESH_MS) throw new AppError('forbidden', 'Please sign out, sign in again, then delete your account.')
}

/** Locks every event at once; their photos are purged after the usual seven days. */
export async function deleteAccount(userId: string, sessionToken: string | null, password?: string): Promise<void> {
  await requireProof(userId, sessionToken, password)
  await withTx(async (tx) => {
    const locked = await tx
      .update(events)
      .set({ deletedAt: new Date() })
      .where(and(eq(events.ownerId, userId), isNull(events.deletedAt)))
      .returning({ id: events.id })
    for (const e of locked) await publish(tx, { eventId: e.id, type: 'deleted', ids: [], audience: 'everyone' })
    await tx.delete(user).where(eq(user.id, userId))
  })
}
