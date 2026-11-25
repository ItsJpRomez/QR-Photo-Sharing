import { config } from '@/config'
import { DiskStorage } from './disk'
import { S3Storage } from './s3'
import type { ObjectStorage } from './types'

export { keys } from './keys'
export type { ObjectStorage } from './types'

let instance: ObjectStorage | undefined

function get(): ObjectStorage {
  instance ??= config.storage.driver === 'disk' ? new DiskStorage(config.storage.dir) : new S3Storage(config.storage)
  return instance
}

export const storage: ObjectStorage = {
  signPut: (o) => get().signPut(o),
  signGet: (key, o) => get().signGet(key, o),
  head: (key) => get().head(key),
  read: (key) => get().read(key),
  readStream: (key) => get().readStream(key),
  put: (key, body, type) => get().put(key, body, type),
  delete: (keys) => get().delete(keys),
  deletePrefix: (prefix) => get().deletePrefix(prefix),
}
