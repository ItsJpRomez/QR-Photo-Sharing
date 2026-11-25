export type ItemState =
  | 'waiting'
  | 'uploading'
  | 'offline'
  | 'added'
  | 'waiting_for_host'
  | 'failed'
  /** The host closed uploads. */
  | 'closed'
  /** The PIN or the link changed. */
  | 'needs_access'

export type ItemMeta = { albumId: string | null; tags: string[]; name?: string }

export type QueueItem = {
  clientId: string
  eventId: string
  code: string
  fileName: string
  size: number
  mime: string
  meta: ItemMeta
  state: ItemState
  progress: number
  attempts: number
  reason?: string
  photoId?: string
  addedAt: number
  /** The server has it for good. Nothing is left to do. */
  settled: boolean
  /** Kept on this phone, so a reload won't lose it. */
  persisted: boolean
}

export type UploadState =
  | 'reserved'
  | 'processing'
  | 'live'
  | 'pending'
  | 'already_added'
  | 'received'
  | 'failed'
  | 'expired'
  | 'removed_by_host'

export type Reserved = { photoId: string; state: UploadState; reason: string | null; put?: { url: string; headers: Record<string, string> } }

/** Why a step didn't work. Status 0 means no answer came back. */
export class TransportError extends Error {
  readonly code: string
  readonly status: number

  constructor(code: string, status: number, message = code) {
    super(message)
    this.name = 'TransportError'
    this.code = code
    this.status = status
  }
}

export interface Transport {
  reserve(item: QueueItem): Promise<Reserved>
  put(url: string, headers: Record<string, string>, file: Blob, onProgress: (sent: number) => void, signal: AbortSignal): Promise<void>
  complete(item: QueueItem): Promise<Reserved>
  states(code: string, photoIds: string[]): Promise<{ photoId: string; state: UploadState; reason: string | null }[]>
}

export interface QueueStore {
  list(): Promise<QueueItem[]>
  add(item: QueueItem, file: Blob): Promise<void>
  update(item: QueueItem): Promise<void>
  file(clientId: string): Promise<Blob | null>
  remove(clientId: string): Promise<void>
  /** Takes or renews a short claim. False while someone else holds it. */
  claim(owner: string, now: number, forMs: number): Promise<boolean>
  release(owner: string): Promise<void>
}

/** Makes sure only one tab sends. Calls back when this tab may. */
export interface LeaderLock {
  request(onHeld: () => void): () => void
}

export interface Clock {
  now(): number
  after(ms: number, fn: () => void): () => void
}

/** Lets tabs tell each other that the queue changed, and which photos are finished. */
export interface Channel {
  post(done: QueueItem[]): void
  listen(fn: (done: QueueItem[]) => void): () => void
}
