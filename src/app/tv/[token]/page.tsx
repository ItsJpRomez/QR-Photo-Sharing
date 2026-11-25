import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { Tv } from '@/features/tv/tv'
import { AppError } from '@/lib/errors'
import { eventByTvToken, tvView } from '@/modules/tv/tv'

export const metadata: Metadata = { title: 'Live photos' }

export default async function TvPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const event = await eventByTvToken(token).catch((err: unknown) => {
    if (err instanceof AppError && err.code === 'not_found') notFound()
    throw err
  })
  return <Tv token={token} initial={await tvView(event)} />
}
