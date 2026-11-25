import type { Readable } from 'node:stream'
import {
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3'
import { Upload } from '@aws-sdk/lib-storage'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import type { S3Config } from '@/config'
import { assertPrefix, attachment, GET_SECONDS, hourStart, PUT_SECONDS, type ObjectStorage } from './types'

// Links change every hour, so a file is never kept longer than its link works.
const CACHE = 'private, max-age=3600'

/** Cloudflare R2, or any other S3-compatible service. */
export class S3Storage implements ObjectStorage {
  private readonly client: S3Client
  private readonly bucket: string

  constructor(c: S3Config) {
    this.bucket = c.bucket
    this.client = new S3Client({
      endpoint: c.endpoint,
      region: c.region,
      credentials: { accessKeyId: c.accessKeyId, secretAccessKey: c.secretAccessKey },
      forcePathStyle: true,
      requestChecksumCalculation: 'WHEN_REQUIRED',
      responseChecksumValidation: 'WHEN_REQUIRED',
    })
  }

  async signPut(o: { key: string; size: number; contentType: string }) {
    const command = new PutObjectCommand({ Bucket: this.bucket, Key: o.key, ContentLength: o.size, ContentType: o.contentType })
    const url = await getSignedUrl(this.client, command, {
      expiresIn: PUT_SECONDS,
      signableHeaders: new Set(['content-length', 'content-type', 'host']),
    })
    // The browser sets content-length itself; scripts are not allowed to.
    return { url, headers: { 'content-type': o.contentType } }
  }

  async signGet(key: string, o: { downloadName?: string; now?: Date; seconds?: number } = {}) {
    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: key,
      ResponseContentDisposition: o.downloadName === undefined ? undefined : attachment(o.downloadName),
    })
    return getSignedUrl(this.client, command, { expiresIn: o.seconds ?? GET_SECONDS, signingDate: hourStart(o.now ?? new Date()) })
  }

  async head(key: string) {
    try {
      const r = await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }))
      return { size: r.ContentLength ?? 0 }
    } catch (err) {
      if ((err as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode === 404) return null
      throw err
    }
  }

  async read(key: string) {
    const r = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }))
    return Buffer.from(await r.Body!.transformToByteArray())
  }

  async readStream(key: string) {
    const r = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }))
    return r.Body as Readable
  }

  async put(key: string, body: Buffer | Readable, contentType: string) {
    if (Buffer.isBuffer(body)) {
      await this.client.send(new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: body, ContentType: contentType, CacheControl: CACHE }))
      return { size: body.length }
    }
    let size = 0
    const counted = (async function* () {
      for await (const chunk of body) {
        size += (chunk as Buffer).length
        yield chunk as Buffer
      }
    })()
    const { Readable: NodeReadable } = await import('node:stream')
    // 16 MB parts allow objects up to 160 GB within the 10,000-part limit.
    await new Upload({
      client: this.client,
      params: { Bucket: this.bucket, Key: key, Body: NodeReadable.from(counted), ContentType: contentType, CacheControl: CACHE },
      partSize: 16 * 1024 * 1024,
      queueSize: 2,
      leavePartsOnError: false,
    }).done()
    return { size }
  }

  async delete(keys: string[]) {
    for (let i = 0; i < keys.length; i += 1000) {
      const Objects = keys.slice(i, i + 1000).map((Key) => ({ Key }))
      const r = await this.client.send(new DeleteObjectsCommand({ Bucket: this.bucket, Delete: { Objects, Quiet: true } }))
      if (r.Errors?.length) throw new Error(`Could not delete ${r.Errors.length} objects`)
    }
  }

  async deletePrefix(prefix: string) {
    assertPrefix(prefix)
    let token: string | undefined
    do {
      const r = await this.client.send(new ListObjectsV2Command({ Bucket: this.bucket, Prefix: prefix, ContinuationToken: token }))
      await this.delete((r.Contents ?? []).map((o) => o.Key!))
      token = r.NextContinuationToken
    } while (token)
  }
}
