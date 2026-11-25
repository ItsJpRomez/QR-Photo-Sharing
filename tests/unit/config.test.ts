import { describe, expect, test } from 'vitest'
import { parseConfig } from '@/config'

const good = {
  NODE_ENV: 'test',
  DATABASE_URL: 'postgres://localhost/x',
  APP_URL: 'http://localhost:3000',
  APP_SECRET: 'x'.repeat(32),
  STORAGE_DRIVER: 'disk',
}

describe('parseConfig', () => {
  test('names the variable that is missing', () => {
    expect(() => parseConfig({ ...good, DATABASE_URL: undefined })).toThrow(/DATABASE_URL/)
  })

  test('refuses the disk driver in production', () => {
    expect(() => parseConfig({ ...good, NODE_ENV: 'production' })).toThrow(/disk/i)
  })

  test('refuses a short secret', () => {
    expect(() => parseConfig({ ...good, APP_SECRET: 'short' })).toThrow(/APP_SECRET/)
  })

  test('requires every S3 setting when the s3 driver is chosen', () => {
    expect(() => parseConfig({ ...good, STORAGE_DRIVER: 's3' })).toThrow(/S3_BUCKET/)
  })

  test('refuses production without email, so verification can work', () => {
    expect(() =>
      parseConfig({
        ...good,
        NODE_ENV: 'production',
        STORAGE_DRIVER: 's3',
        S3_ENDPOINT: 'https://r2.test',
        S3_BUCKET: 'b',
        S3_ACCESS_KEY_ID: 'a',
        S3_SECRET_ACCESS_KEY: 's',
      }),
    ).toThrow(/SMTP_URL/)
  })

  test('defaults the name and limits from the spec', () => {
    const c = parseConfig(good)
    expect(c.appName).toBe('Event Photos')
    expect(c.limits).toMatchObject({
      photosPerEvent: 5000,
      bytesPerEvent: 25 * 1024 ** 3,
      eventsPerHost: 10,
      photosPerGuest: 500,
      reservationsPerMinute: 60,
      commentsPerMinute: 10,
      maxPhotoBytes: 40 * 1024 ** 2,
      maxPixels: 100_000_000,
    })
  })
})
