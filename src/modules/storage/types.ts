import type { Readable } from 'node:stream'

export interface ObjectStorage {
  /** A link that accepts one upload of exactly `size` bytes, for 15 minutes. */
  signPut(o: { key: string; size: number; contentType: string }): Promise<{ url: string; headers: Record<string, string> }>
  /** A read link. Identical for the whole hour so browsers can cache it; dead within two. */
  signGet(key: string, o?: { downloadName?: string; now?: Date }): Promise<string>
  head(key: string): Promise<{ size: number } | null>
  read(key: string): Promise<Buffer>
  readStream(key: string): Promise<Readable>
  put(key: string, body: Buffer | Readable, contentType: string): Promise<{ size: number }>
  delete(keys: string[]): Promise<void>
  deletePrefix(prefix: string): Promise<void>
}

export const PUT_SECONDS = 15 * 60
export const GET_SECONDS = 2 * 60 * 60

export function hourStart(now: Date): Date {
  return new Date(Math.floor(now.getTime() / 3_600_000) * 3_600_000)
}

/** A download header that survives quotes, line breaks and accents. */
export function attachment(name: string): string {
   
  const clean = name.replace(/[\u0000-\u001f\u007f]/g, '').trim() || 'photo'
  const ascii = clean.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_')
  const utf8 = encodeURIComponent(clean).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)
  return `attachment; filename="${ascii}"; filename*=UTF-8''${utf8}`
}

/** Every deletion must name one event's folder, so a bug can't empty the bucket. */
export function assertPrefix(prefix: string): void {
  if (!/^ev\/[^/]+\/(?:.*\/)?$/.test(prefix)) throw new Error(`Unsafe storage prefix: ${JSON.stringify(prefix)}`)
}
