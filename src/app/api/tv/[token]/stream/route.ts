import { route } from '@/lib/route'
import { eventStream } from '@/modules/live/stream'
import { eventByTvToken } from '@/modules/tv/tv'

export const GET = route<{ token: string }>(async (req, { params }) => {
  const event = await eventByTvToken((await params).token)
  return eventStream(event.id, { kind: 'tv', eventId: event.id }, req.signal)
})
