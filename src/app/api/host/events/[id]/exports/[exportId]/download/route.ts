import { hostRoute, requireUuid } from '@/lib/host-route'
import { exportDownloadUrl } from '@/modules/exports/build'

export const GET = hostRoute<{ id: string; exportId: string }>(async (_req, { event, viewer, params }) =>
  Response.json({ url: await exportDownloadUrl(viewer, event, requireUuid(params.exportId)) }),
)
