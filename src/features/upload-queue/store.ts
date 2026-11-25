import { openDB, type DBSchema, type IDBPDatabase } from 'idb'
import type { QueueItem, QueueStore } from './types'

interface Schema extends DBSchema {
  items: { key: string; value: QueueItem; indexes: { addedAt: number } }
  // Files live apart from their details, so listing the queue never loads a photo.
  // Plain bytes, because Safari can hang storing several Blobs.
  files: { key: string; value: { data: ArrayBuffer; type: string } }
  claims: { key: string; value: { owner: string; until: number } }
}

export class IdbStore implements QueueStore {
  private opened: Promise<IDBPDatabase<Schema>> | undefined

  private db(): Promise<IDBPDatabase<Schema>> {
    this.opened ??= openDB<Schema>('upload-queue', 1, {
      upgrade(db) {
        db.createObjectStore('items', { keyPath: 'clientId' }).createIndex('addedAt', 'addedAt')
        db.createObjectStore('files')
        db.createObjectStore('claims')
      },
    })
    this.opened.catch(() => {
      this.opened = undefined
    })
    return this.opened
  }

  async list() {
    return (await this.db()).getAllFromIndex('items', 'addedAt')
  }

  async add(item: QueueItem, file: Blob) {
    const data = await file.arrayBuffer()
    const tx = (await this.db()).transaction(['items', 'files'], 'readwrite')
    await Promise.all([tx.objectStore('items').put(item), tx.objectStore('files').put({ data, type: file.type }, item.clientId), tx.done])
  }

  async update(item: QueueItem) {
    const tx = (await this.db()).transaction('items', 'readwrite')
    // Never brings back something that was removed meanwhile.
    if (await tx.store.getKey(item.clientId)) await tx.store.put(item)
    await tx.done
  }

  async file(clientId: string) {
    const stored = await (await this.db()).get('files', clientId)
    return stored ? new Blob([stored.data], { type: stored.type }) : null
  }

  async remove(clientId: string) {
    const tx = (await this.db()).transaction(['items', 'files'], 'readwrite')
    await Promise.all([tx.objectStore('items').delete(clientId), tx.objectStore('files').delete(clientId), tx.done])
  }

  async claim(owner: string, now: number, forMs: number) {
    const tx = (await this.db()).transaction('claims', 'readwrite')
    const current = await tx.store.get('sender')
    const free = !current || current.owner === owner || current.until <= now
    if (free) await tx.store.put({ owner, until: now + forMs }, 'sender')
    await tx.done
    return free
  }

  async release(owner: string) {
    const tx = (await this.db()).transaction('claims', 'readwrite')
    if ((await tx.store.get('sender'))?.owner === owner) await tx.store.delete('sender')
    await tx.done
  }
}
