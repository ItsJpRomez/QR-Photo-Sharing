import { hostRoute } from '@/lib/host-route'
import { hostEvent, updateSettings } from '@/modules/events/events'
import { settingsPatch } from '@/modules/events/input'

export const PATCH = hostRoute<{ id: string }>(async (req, { event }) =>
  Response.json(await hostEvent(await updateSettings(event.id, settingsPatch.parse(await req.json())))),
)
