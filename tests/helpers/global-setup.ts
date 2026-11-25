import { drizzle } from 'drizzle-orm/node-postgres'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import fs from 'node:fs'
import { Pool } from 'pg'

export default async function setup() {
  const url = process.env.TEST_DATABASE_URL ?? 'postgres://localhost/event_photos_test'
  const pool = new Pool({ connectionString: url })
  // Guard: this wipes the database, so it only ever runs on the test one.
  if (!new URL(url).pathname.endsWith('event_photos_test')) throw new Error('Refusing to reset a non-test database')
  await pool.query('drop schema if exists public cascade; drop schema if exists drizzle cascade; drop schema if exists pgboss cascade; create schema public')
  if (fs.existsSync('drizzle/meta')) await migrate(drizzle(pool), { migrationsFolder: 'drizzle' })
  await pool.end()
  fs.rmSync('.data/test-storage', { recursive: true, force: true })
}
