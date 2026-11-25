import { openDB, type DBSchema, type IDBPDatabase } from 'idb'
import type { QueueItem, QueueStore } from './types'

interface Schema extends DBSchema {
  items: { key: string; value: QueueItem; indexes: { addedAt: number } }
  // Files live apart from their details, so listing the queue never loads a photo.
  // Plain bytes, because Safari can hang storing several Blobs.
  files: { key: string; value: { data: ArrayBuffer; type: string } }
  claims: { key: string; value: { owner: string; until: number } }
}

type Database = IDBPDatabase<Schema>

export class IdbStore implements QueueStore {
  private opened: Promise<Database> | undefined

  private db(): Promise<Database> {
    const forget = () => {
      this.opened = undefined
    }
    this.opened ??= openDB<Schema>('upload-queue', 1, {
      upgrade(db) {
        db.createObjectStore('items', { keyPath: 'clientId' }).createIndex('addedAt', 'addedAt')
        db.createObjectStore('files')
        db.createObjectStore('claims')
      },
      // Phones may close it while the page is in the background.
      terminated: forget,
    })
    this.opened.catch(forget)
    return this.opened
  }

  /** Runs on the open database, opening it again once if it was closed behind us. */
  private async use<T>(work: (db: Database) => Promise<T>): Promise<T> {
    const db = await this.db()
    try {
      return await work(db)
    } catch (err) {
      if ((err as DOMException).name !== 'InvalidStateError') throw err
      this.opened = undefined
      return work(await this.db())
    }
  }

  list() {
    return this.use((db) => db.getAllFromIndex('items', 'addedAt'))
  }

  add(item: QueueItem, file: { data: ArrayBuffer; type: string }) {
    return this.use(async (db) => {
      const tx = db.transaction(['items', 'files'], 'readwrite')
      await Promise.all([tx.objectStore('items').put(item), tx.objectStore('files').put(file, item.clientId), tx.done])
    })
  }

  update(item: QueueItem) {
    return this.use(async (db) => {
      const tx = db.transaction('items', 'readwrite')
      // Never brings back something that was removed meanwhile.
      if (await tx.store.getKey(item.clientId)) await tx.store.put(item)
      await tx.done
    })
  }

  async file(clientId: string) {
    const stored = await this.use((db) => db.get('files', clientId))
    return stored ? new Blob([stored.data], { type: stored.type }) : null
  }

  remove(clientId: string) {
    return this.use(async (db) => {
      const tx = db.transaction(['items', 'files'], 'readwrite')
      await Promise.all([tx.objectStore('items').delete(clientId), tx.objectStore('files').delete(clientId), tx.done])
    })
  }

  claim(owner: string, now: number, forMs: number, byForce = false) {
    return this.use(async (db) => {
      const tx = db.transaction('claims', 'readwrite')
      const current = await tx.store.get('sender')
      const free = byForce || !current || current.owner === owner || current.until <= now
      if (free) await tx.store.put({ owner, until: now + forMs }, 'sender')
      await tx.done
      return free
    })
  }

  release(owner: string) {
    return this.use(async (db) => {
      const tx = db.transaction('claims', 'readwrite')
      if ((await tx.store.get('sender'))?.owner === owner) await tx.store.delete('sender')
      await tx.done
    })
  }
}
