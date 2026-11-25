import type { Metadata } from 'next'
import { headers } from 'next/headers'
import { notFound } from 'next/navigation'
import { cache, Suspense } from 'react'
import { EventScreen } from '@/features/gallery/event-screen'
import { AppError } from '@/lib/errors'
import { resolveViewer } from '@/modules/access/viewer'
import { lockedEvent, openEvent } from '@/modules/events/view'

type Props = { params: Promise<{ code: string }> }

const load = cache(async (code: string) => {
  const { event, viewer, me } = await resolveViewer({ code }, { headers: await headers() }).catch((err: unknown) => {
    if (err instanceof AppError && err.code === 'not_found') notFound()
    throw err
  })
  return viewer.kind === 'locked' || !me ? lockedEvent(event) : openEvent(event, viewer, me)
})

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  return { title: (await load((await params).code)).name }
}

export default async function EventPage({ params }: Props) {
  const { code } = await params
  const initial = await load(code)
  return (
    <Suspense>
      <EventScreen code={code} initial={initial} />
    </Suspense>
  )
}
