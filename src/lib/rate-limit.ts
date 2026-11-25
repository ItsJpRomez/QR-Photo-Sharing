import { and, eq, gt, sql } from 'drizzle-orm'
import { db } from '@/db/client'
import { rateLimits } from '@/db/schema'

const windowStart = (windowSec: number) => new Date(Math.floor(Date.now() / (windowSec * 1000)) * windowSec * 1000)

/** Counts one use and returns the total so far in this window. */
export async function countHit(key: string, windowSec: number): Promise<number> {
  const [row] = await db
    .insert(rateLimits)
    .values({ key, windowStart: windowStart(windowSec), count: 1 })
    .onConflictDoUpdate({ target: [rateLimits.key, rateLimits.windowStart], set: { count: sql`${rateLimits.count} + 1` } })
    .returning({ count: rateLimits.count })
  return row!.count
}

/** Counts one use. True while within the limit. */
export async function hitLimit(key: string, max: number, windowSec: number): Promise<boolean> {
  return (await countHit(key, windowSec)) <= max
}

/** Gives back one use. */
export async function refundHit(key: string, windowSec: number): Promise<void> {
  await db
    .update(rateLimits)
    .set({ count: sql`${rateLimits.count} - 1` })
    .where(and(eq(rateLimits.key, key), eq(rateLimits.windowStart, windowStart(windowSec)), gt(rateLimits.count, 0)))
}
