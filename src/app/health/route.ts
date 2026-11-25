import { eq, sql } from 'drizzle-orm'
import * as client from '@/db/client'
import { heartbeats } from '@/db/schema'
import { storage } from '@/modules/storage'

const LIMIT_MS = 3000
const SILENT_MS = 60_000

const CHECKS: Record<string, () => Promise<boolean>> = {
  database: async () => {
    await client.db.execute(sql`select 1`)
    return true
  },
  storage: async () => {
    await storage.head('ev/health/check') // absent is fine: what matters is that it answered
    return true
  },
  worker: async () => {
    const [last] = await client.db.select().from(heartbeats).where(eq(heartbeats.name, 'worker'))
    return last !== undefined && Date.now() - last.at.getTime() < SILENT_MS
  },
}

async function passes(check: () => Promise<boolean>): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const late = new Promise<boolean>((resolve) => {
    timer = setTimeout(() => resolve(false), LIMIT_MS)
  })
  try {
    return await Promise.race([check(), late])
  } catch {
    return false
  } finally {
    clearTimeout(timer)
  }
}

/** For uptime monitors. Says what is wrong, never why. */
export async function GET(): Promise<Response> {
  const results = await Promise.all(Object.entries(CHECKS).map(async ([name, check]) => ((await passes(check)) ? [] : [name])))
  const failing = results.flat()
  return Response.json({ ok: failing.length === 0, failing }, { status: failing.length ? 503 : 200, headers: { 'cache-control': 'no-store' } })
}
