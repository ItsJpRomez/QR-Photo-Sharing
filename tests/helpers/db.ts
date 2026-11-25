import { sql } from 'drizzle-orm'
import { db } from '@/db/client'

export async function resetDb(): Promise<void> {
  const { rows } = await db.execute<{ t: string }>(
    sql`select quote_ident(tablename) as t from pg_tables where schemaname = 'public'`,
  )
  if (rows.length) await db.execute(sql.raw(`truncate ${rows.map((r) => r.t).join(', ')} restart identity cascade`))
}
