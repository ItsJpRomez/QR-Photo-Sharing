import { z } from 'zod'
import { route } from '@/lib/route'
import { eventByTvToken, tvPhotosById, tvView } from '@/modules/tv/tv'

const ids = z.array(z.uuid()).max(100)

export const GET = route<{ token: string }>(async (req, { params }) => {
  const event = await eventByTvToken((await params).token)
  const wanted = new URL(req.url).searchParams.get('ids')
  if (wanted !== null) return Response.json(await tvPhotosById(event, ids.parse(wanted.split(',').filter(Boolean))))
  return Response.json(await tvView(event))
})
