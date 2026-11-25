import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { db, getPool } from '../src/db/client'

await migrate(db, { migrationsFolder: 'drizzle' })
await getPool().end()
console.log('Database is up to date.')
