import { z } from 'zod'
import { AppError } from '@/lib/errors'
import { safeFileName } from '@/lib/file-name'
import { hostRoute } from '@/lib/host-route'
import { pinMatches } from '@/modules/events/pin'
import { eventUrl } from '@/modules/signs/qr'
import { signInput, signPdf, signPng } from '@/modules/signs/render'
import { unsupportedGlyphs } from '@/modules/signs/text'
import { attachment } from '@/modules/storage/types'

const body = signInput.extend({ format: z.enum(['preview', 'png', 'pdf']) })

// POST, so a PIN is never part of an address.
export const POST = hostRoute<{ id: string }>(async (req, { event }) => {
  const { format, ...input } = body.parse(await req.json())
  if (input.pin && !pinMatches(event, input.pin)) throw new AppError('bad_input', "That isn't this event's PIN.")
  const options = { ...input, accent: event.accent, url: eventUrl(event.code) }
  const bytes = format === 'pdf' ? await signPdf(options) : await signPng(options, { preview: format === 'preview' })
  return new Response(new Uint8Array(bytes), {
    headers: {
      'content-type': format === 'pdf' ? 'application/pdf' : 'image/png',
      'content-disposition': attachment(`${safeFileName(event.name)} sign ${input.size}.${format === 'pdf' ? 'pdf' : 'png'}`),
      'x-missing-characters': encodeURIComponent(unsupportedGlyphs(`${input.headline}${input.subtext}`).join(' ')),
    },
  })
})
