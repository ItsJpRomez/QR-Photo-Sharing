import { expect, test } from 'vitest'
import { S3Storage } from '@/modules/storage/s3'

const s = new S3Storage({ endpoint: 'https://acc.r2.test', region: 'auto', bucket: 'b', accessKeyId: 'AK', secretAccessKey: 'SK' })

test('the upload signature covers the exact size and type', async () => {
  const { url, headers } = await s.signPut({ key: 'ev/1/incoming/2', size: 1234, contentType: 'image/heic' })
  const u = new URL(url)
  const signed = u.searchParams.get('X-Amz-SignedHeaders')!.split(';')
  expect(signed).toContain('content-length')
  expect(signed).toContain('content-type')
  expect(u.searchParams.get('X-Amz-Expires')).toBe('900')
  expect(headers).toEqual({ 'content-type': 'image/heic' })
  expect(url).not.toMatch(/checksum/i)
})

test('read links repeat within the hour and last two', async () => {
  const at = (t: string) => s.signGet('ev/1/thumb/2.webp', { now: new Date(`2026-06-12T${t}:00Z`) })
  expect(await at('10:05')).toBe(await at('10:55'))
  expect(await at('11:05')).not.toBe(await at('10:55'))
  const u = new URL(await at('10:05'))
  expect(u.searchParams.get('X-Amz-Expires')).toBe('7200')
  expect(u.searchParams.get('X-Amz-Date')).toBe('20260612T100000Z')
})
