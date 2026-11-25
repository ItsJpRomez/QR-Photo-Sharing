import { z } from 'zod'
import { safeFileName } from '@/lib/file-name'
import { hostRoute } from '@/lib/host-route'
import { eventUrl, qrPng, qrSvg } from '@/modules/signs/qr'
import { attachment } from '@/modules/storage/types'

const format = z.enum(['png', 'svg'])

export const GET = hostRoute<{ id: string }>(async (req, { event }) => {
  const kind = format.parse(new URL(req.url).searchParams.get('format'))
  const url = eventUrl(event.code)
  const o = { dark: event.accent }
  const body = kind === 'png' ? new Uint8Array(await qrPng(url, 2048, o)) : qrSvg(url, o)
  return new Response(body, {
    headers: {
      'content-type': kind === 'png' ? 'image/png' : 'image/svg+xml',
      'content-disposition': attachment(`${safeFileName(event.name)} QR.${kind}`),
      'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox",
    },
  })
})
