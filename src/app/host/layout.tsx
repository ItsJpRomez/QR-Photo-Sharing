import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { safeNext } from '@/auth/server'
import { getUser } from '@/auth/session'
import { config } from '@/config'
import { CheckEmail } from '@/features/auth/check-email'
import { HostNav } from '@/features/host/host-nav'

export default async function HostLayout({ children }: { children: React.ReactNode }) {
  const h = await headers()
  const user = await getUser(h)
  if (!user) redirect(`/sign-in?next=${encodeURIComponent(safeNext(h.get('x-path')))}`)
  if (!user.emailVerified) return <CheckEmail email={user.email} />
  return (
    <>
      <HostNav appName={config.appName} />
      {children}
    </>
  )
}
