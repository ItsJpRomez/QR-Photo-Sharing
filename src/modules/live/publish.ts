import { sql } from 'drizzle-orm'
import type { Executor } from '@/db/client'

export type LiveType =
  | 'photos'
  | 'event'
  | 'comments'
  | 'hearts'
  | 'export'
  /** The PIN or the link changed, so guests must be let in again. */
  | 'access'
  | 'deleted'
  /** The TV link was replaced. */
  | 'tv'

export type LiveMessage = {
  eventId: string
  type: LiveType
  ids: string[]
  /** A list names participants. The host always receives. */
  audience: 'everyone' | 'host' | string[]
}

export const CHANNEL = 'event_changes'

/** Postgres limits a notification to 8000 bytes. */
const MAX_IDS = 100

/** Announces a change. Inside a transaction, it goes out only if that commits. */
export async function publish(tx: Executor, msg: LiveMessage): Promise<void> {
  for (let at = 0; at === 0 || at < msg.ids.length; at += MAX_IDS) {
    const part: LiveMessage = { ...msg, ids: msg.ids.slice(at, at + MAX_IDS) }
    await tx.execute(sql`select pg_notify(${CHANNEL}, ${JSON.stringify(part)})`)
  }
}
