import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'
import { config } from '@/config'
import * as schema from './schema'
import * as authSchema from './auth-schema'

const allTables = { ...schema, ...authSchema }
export type Db = NodePgDatabase<typeof allTables>
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0]
/** Either the pool or an open transaction. */
export type Executor = Db | Tx

const shared = globalThis as unknown as { __pool?: Pool; __db?: Db }

export function getPool(): Pool {
  if (!shared.__pool) {
    shared.__pool = new Pool({ connectionString: config.databaseUrl, max: 20 })
    shared.__pool.on('error', (err) => console.error('Idle database connection failed', err.message))
  }
  return shared.__pool
}

export const db: Db = new Proxy({} as Db, {
  get(_target, key) {
    shared.__db ??= drizzle(getPool(), { schema: allTables })
    const value = Reflect.get(shared.__db, key)
    return typeof value === 'function' ? value.bind(shared.__db) : value
  },
})

export function withTx<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  return db.transaction(fn)
}
