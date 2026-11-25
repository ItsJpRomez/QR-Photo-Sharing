import { createReadStream, createWriteStream } from 'node:fs'
import fs from 'node:fs/promises'
import path from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { config } from '@/config'
import { hmacHex, safeEqual } from '@/lib/ids'
import { assertPrefix, GET_SECONDS, hourStart, PUT_SECONDS, type ObjectStorage } from './types'

type Grant = { method: 'GET' | 'PUT'; key: string; exp: number; size?: string; type?: string; name?: string }

const sign = (g: Grant) => hmacHex(JSON.stringify(['disk', g.method, g.key, g.exp, g.size ?? '', g.type ?? '', g.name ?? '']))

/** Checks a storage link. Returns the grant, or null when it isn't valid. */
export function verifyDiskUrl(method: 'GET' | 'PUT', key: string, q: URLSearchParams): Grant | null {
  const g: Grant = {
    method,
    key,
    exp: Number(q.get('exp')),
    size: q.get('size') ?? undefined,
    type: q.get('type') ?? undefined,
    name: q.get('name') ?? undefined,
  }
  if (!Number.isFinite(g.exp) || g.exp * 1000 < Date.now()) return null
  return safeEqual(sign(g), q.get('sig') ?? '') ? g : null
}

/** Development storage: files in a folder, with links signed by the app. */
export class DiskStorage implements ObjectStorage {
  readonly root: string

  constructor(dir: string) {
    this.root = path.resolve(/* turbopackIgnore: true */ dir)
  }

  filePath(key: string): string {
    const parts = key.split('/')
    const bad = key.includes('\0') || key.includes('\\') || parts.some((p) => p === '' || p === '.' || p === '..')
    const file = path.resolve(this.root, ...parts)
    if (bad || !file.startsWith(this.root + path.sep)) throw new Error('Unsafe storage key')
    return file
  }

  private url(g: Grant): string {
    const q = new URLSearchParams({ exp: String(g.exp) })
    if (g.size !== undefined) q.set('size', g.size)
    if (g.type !== undefined) q.set('type', g.type)
    if (g.name !== undefined) q.set('name', g.name)
    q.set('sig', sign(g))
    return `${config.appUrl}/api/storage/${g.key.split('/').map(encodeURIComponent).join('/')}?${q}`
  }

  async signPut(o: { key: string; size: number; contentType: string }) {
    this.filePath(o.key)
    const exp = Math.floor(Date.now() / 1000) + PUT_SECONDS
    const url = this.url({ method: 'PUT', key: o.key, exp, size: String(o.size), type: o.contentType })
    return { url, headers: { 'content-type': o.contentType } }
  }

  async signGet(key: string, o: { downloadName?: string; now?: Date; seconds?: number } = {}) {
    this.filePath(key)
    const exp = hourStart(o.now ?? new Date()).getTime() / 1000 + (o.seconds ?? GET_SECONDS)
    return this.url({ method: 'GET', key, exp, name: o.downloadName })
  }

  async head(key: string) {
    try {
      const s = await fs.stat(this.filePath(key))
      return s.isFile() ? { size: s.size } : null
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw err
    }
  }

  async read(key: string) {
    return fs.readFile(this.filePath(key))
  }

  async readStream(key: string) {
    const file = this.filePath(key)
    await fs.access(file)
    return createReadStream(file)
  }

  async put(key: string, body: Buffer | Readable, _contentType: string) {
    const file = this.filePath(key)
    const temp = `${file}.${crypto.randomUUID()}.part`
    await fs.mkdir(path.dirname(file), { recursive: true })
    try {
      await pipeline(Buffer.isBuffer(body) ? Readable.from([body]) : body, createWriteStream(temp))
      await fs.rename(temp, file)
    } catch (err) {
      await fs.rm(temp, { force: true })
      throw err
    }
    return { size: (await fs.stat(file)).size }
  }

  async delete(keys: string[]) {
    for (const key of keys) await fs.rm(this.filePath(key), { force: true })
  }

  async deletePrefix(prefix: string) {
    assertPrefix(prefix)
    await fs.rm(this.filePath(prefix.slice(0, -1)), { recursive: true, force: true })
  }
}
