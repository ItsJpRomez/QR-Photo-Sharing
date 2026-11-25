import { createReadStream } from 'node:fs'
import { Readable } from 'node:stream'
import { config } from '@/config'
import { DiskStorage, verifyDiskUrl } from '@/modules/storage/disk'
import { attachment } from '@/modules/storage/types'

// Development only: stands in for the storage service's own signed links.

type Ctx = { params: Promise<{ key: string[] }> }

const TYPES: Record<string, string> = { webp: 'image/webp', jpg: 'image/jpeg', zip: 'application/zip' }
const deny = (status: number) => new Response(null, { status })
const disk = () => (config.storage.driver === 'disk' ? new DiskStorage(config.storage.dir) : null)

export async function GET(req: Request, ctx: Ctx): Promise<Response> {
  const store = disk()
  if (!store) return deny(404)
  const key = (await ctx.params).key.join('/')
  const grant = verifyDiskUrl('GET', key, new URL(req.url).searchParams)
  if (!grant) return deny(403)
  const found = await store.head(key)
  if (!found) return deny(404)

  const headers = new Headers({
    'content-type': TYPES[key.split('.').pop() ?? ''] ?? 'application/octet-stream',
    'accept-ranges': 'bytes',
    'cache-control': 'private, max-age=3600',
    'x-content-type-options': 'nosniff',
    'content-security-policy': 'sandbox',
  })
  if (grant.name !== undefined) headers.set('content-disposition', attachment(grant.name))

  let start = 0
  let end = found.size - 1
  let status = 200
  const range = /^bytes=(\d+)-(\d*)$/.exec(req.headers.get('range') ?? '')
  if (range) {
    start = Number(range[1])
    if (range[2]) end = Math.min(end, Number(range[2]))
    if (start > end) return new Response(null, { status: 416, headers: { 'content-range': `bytes */${found.size}` } })
    status = 206
    headers.set('content-range', `bytes ${start}-${end}/${found.size}`)
  }
  headers.set('content-length', String(end - start + 1))
  const file = createReadStream(store.filePath(key), { start, end })
  return new Response(Readable.toWeb(file) as ReadableStream, { status, headers })
}

export async function PUT(req: Request, ctx: Ctx): Promise<Response> {
  const store = disk()
  if (!store) return deny(404)
  const key = (await ctx.params).key.join('/')
  const grant = verifyDiskUrl('PUT', key, new URL(req.url).searchParams)
  if (!grant) return deny(403)
  const size = Number(grant.size)
  if (grant.type !== req.headers.get('content-type') || !req.body) return deny(403)

  const limited = async function* () {
    let seen = 0
    for await (const chunk of Readable.fromWeb(req.body as Parameters<typeof Readable.fromWeb>[0])) {
      seen += (chunk as Buffer).length
      if (seen > size) throw new Error('too long')
      yield chunk as Buffer
    }
    if (seen !== size) throw new Error('too short')
  }
  try {
    await store.put(key, Readable.from(limited()), grant.type!)
  } catch {
    return deny(400)
  }
  return new Response(null, { status: 200 })
}
