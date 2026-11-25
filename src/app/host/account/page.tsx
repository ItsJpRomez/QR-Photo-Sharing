import { and, eq, isNotNull } from 'drizzle-orm'
import type { Metadata } from 'next'
import { headers } from 'next/headers'
import { getUser } from '@/auth/session'
import { account } from '@/db/auth-schema'
import { db } from '@/db/client'
import { Account } from '@/features/host/account'

export const metadata: Metadata = { title: 'Account' }

export default async function AccountPage() {
  const user = await getUser(await headers())
  if (!user) return null // the host layout has already sent them to sign in
  const [own] = await db
    .select({ id: account.id })
    .from(account)
    .where(and(eq(account.userId, user.id), isNotNull(account.password)))
  return <Account email={user.email} name={user.name} hasPassword={Boolean(own)} />
}
