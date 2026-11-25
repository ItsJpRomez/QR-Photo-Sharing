import { headers } from 'next/headers'
import { notFound } from 'next/navigation'
import { getUser } from '@/auth/session'
import { EventShell } from '@/features/host/event-shell'
import { AppError } from '@/lib/errors'
import { requireOwnedEvent } from '@/modules/access/viewer'
import { hostEvent } from '@/modules/events/events'

type Props = { children: React.ReactNode; params: Promise<{ id: string }> }

export default async function EventLayout({ children, params }: Props) {
  const user = await getUser(await headers())
  if (!user?.emailVerified) return null // the host layout has already sent them elsewhere
  const event = await requireOwnedEvent(user.id, (await params).id).catch((err: unknown) => {
    if (err instanceof AppError && err.code === 'not_found') notFound()
    throw err
  })
  return <EventShell initial={await hostEvent(event)}>{children}</EventShell>
}
