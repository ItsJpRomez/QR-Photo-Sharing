import { describe, test } from 'vitest'
import { S3Storage } from '@/modules/storage/s3'
import { storageContract } from '../helpers/storage-contract'

const e = process.env
if (e.S3_TEST_ENDPOINT && e.S3_TEST_BUCKET && e.S3_TEST_ACCESS_KEY_ID && e.S3_TEST_SECRET_ACCESS_KEY) {
  const s3 = {
    endpoint: e.S3_TEST_ENDPOINT,
    bucket: e.S3_TEST_BUCKET,
    accessKeyId: e.S3_TEST_ACCESS_KEY_ID,
    secretAccessKey: e.S3_TEST_SECRET_ACCESS_KEY,
    region: e.S3_TEST_REGION ?? 'auto',
  }
  storageContract('s3', () => new S3Storage(s3), (url, init) => fetch(url, init))
} else {
  describe('s3 storage', () => {
    test.skip('needs S3_TEST_* credentials', () => {})
  })
}
