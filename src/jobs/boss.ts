import { sql } from 'drizzle-orm'
import { fromDrizzle, PgBoss } from 'pg-boss'
import { config } from '@/config'
import type { Tx } from '@/db/client'

export type Jobs = {
  'photo.process': { photoId: string }
  'photo.purge': { eventId: string; photoId: string }
  'export.build': { exportId: string }
}

const MINUTE = 60
const QUEUES: Record<keyof Jobs, Parameters<PgBoss['createQueue']>[1]> = {
  'photo.process': { retryLimit: 3, retryDelay: 2, retryBackoff: true, expireInSeconds: 5 * MINUTE },
  'photo.purge': { retryLimit: 10, retryDelay: 30, retryBackoff: true, expireInSeconds: 5 * MINUTE },
  'export.build': { retryLimit: 3, retryDelay: 10, retryBackoff: true, expireInSeconds: 6 * 60 * MINUTE, heartbeatSeconds: 60 },
}

const shared = globalThis as unknown as { __boss?: Promise<PgBoss> }

async function open(): Promise<PgBoss> {
  const boss = new PgBoss({ connectionString: config.databaseUrl, max: 4 })
  boss.on('error', (err) => console.error('Job queue problem', err.message))
  await boss.start()
  for (const [name, options] of Object.entries(QUEUES)) {
    await boss.createQueue(name, options)
  }
  return boss
}

export function getBoss(): Promise<PgBoss> {
  shared.__boss ??= open().catch((err: unknown) => {
    shared.__boss = undefined // so the next call tries again
    throw err
  })
  return shared.__boss
}

/** Queues a job as part of a transaction: it runs only if the transaction commits. */
export async function enqueue<N extends keyof Jobs>(tx: Tx, name: N, data: Jobs[N]): Promise<void> {
  const boss = await getBoss()
  await boss.send(name, data, { db: fromDrizzle(tx, sql) })
}
