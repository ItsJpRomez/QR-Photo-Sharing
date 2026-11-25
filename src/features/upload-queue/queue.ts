import {
  TransportError,
  type Channel,
  type Clock,
  type ItemMeta,
  type ItemState,
  type LeaderLock,
  type QueueItem,
  type QueueStore,
  type Reserved,
  type Transport,
  type UploadState,
} from './types'

export type QueueOptions = {
  store: QueueStore
  transport: Transport
  clock: Clock
  random: () => number
  online: () => boolean
  lock: LeaderLock
  channel: Channel
}

const AT_ONCE = 2
const MAX_WAIT_MS = 60_000
const POLL_MS = 3000

/** Answers that will not change by asking again. */
const FINAL = new Set(['bad_type', 'too_large', 'gallery_full', 'guest_limit', 'removed_by_host', 'conflict', 'bad_input', 'forbidden'])

/**
 * Sends photos from this phone, through bad signal, reloads and closed tabs.
 * Every photo is stored before it is sent, and let go only once the server
 * says it is done with it.
 */
export class UploadQueue {
  private list: QueueItem[] = []
  private shown: readonly QueueItem[] = []
  private readonly listeners = new Set<() => void>()
  /** Files that couldn't be stored on the phone. */
  private readonly inMemory = new Map<string, Blob>()
  private readonly sending = new Map<string, AbortController>()
  private readonly notBefore = new Map<string, number>()
  private readonly wakeups = new Map<string, () => void>()
  /** Being written to storage right now. */
  private readonly adding = new Set<string>()
  /** For each read of the storage under way: photos added since it began, which it may have missed. */
  private readonly addedDuring = new Set<Set<string>>()
  /** The link each event is known to answer to now. */
  private readonly codes = new Map<string, string>()
  private running = false
  private leader = false
  private letGo = () => {}
  private unlisten = () => {}
  private cancelPoll: (() => void) | undefined

  constructor(private readonly o: QueueOptions) {}

  items(): readonly QueueItem[] {
    return this.shown
  }

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  start(): void {
    if (this.running) return
    this.running = true
    this.unlisten = this.o.channel.listen((done) => void this.heardFromAnotherTab(done))
    void this.reload().then(() => {
      if (!this.running) return
      this.letGo = this.o.lock.request(() => void this.becomeLeader())
      this.pump() // photos held only in this tab's memory don't need the lock
    })
  }

  stop(): void {
    if (!this.running) return
    this.running = false
    this.leader = false
    for (const c of this.sending.values()) c.abort()
    for (const cancel of this.wakeups.values()) cancel()
    this.wakeups.clear()
    this.cancelPoll?.()
    this.cancelPoll = undefined
    this.unlisten()
    this.letGo()
  }

  async add(files: File[], to: { eventId: string; code: string }, meta: ItemMeta): Promise<{ persisted: boolean }> {
    let persisted = true
    for (const file of files) {
      const item: QueueItem = {
        ...to,
        clientId: crypto.randomUUID(),
        fileName: file.name,
        size: file.size,
        mime: file.type,
        meta,
        state: 'waiting',
        progress: 0,
        attempts: 0,
        addedAt: Math.max(this.o.clock.now(), (this.list.at(-1)?.addedAt ?? 0) + 1),
        settled: false,
        persisted: true,
      }
      this.adding.add(item.clientId)
      for (const ids of this.addedDuring) ids.add(item.clientId)
      this.list.push(item)
      try {
        await this.o.store.add(item, file)
      } catch {
        item.persisted = persisted = false
        this.inMemory.set(item.clientId, file)
      }
      this.adding.delete(item.clientId)
      this.show()
      this.pump()
    }
    this.o.channel.post([])
    return { persisted }
  }

  /** Try everything again now: the signal is back, or the page is in front again. */
  nudge(): void {
    this.notBefore.clear()
    this.pump()
    void this.poll()
  }

  retry(clientId: string): void {
    const item = this.find(clientId)
    if (item?.state !== 'failed') return
    this.notBefore.delete(clientId)
    this.set(item, { state: 'waiting', attempts: 0, progress: 0, reason: undefined })
    this.pump()
  }

  async remove(clientId: string): Promise<void> {
    this.sending.get(clientId)?.abort()
    this.forget(clientId)
    this.list = this.list.filter((i) => i.clientId !== clientId)
    this.show()
    await this.o.store.remove(clientId).catch(() => {})
    this.o.channel.post([])
  }

  /** Takes finished photos off the list. */
  clearFinished(): void {
    this.list = this.list.filter((i) => !i.settled)
    this.show()
  }

  /** The host opened uploads again. */
  reopen(eventId: string): void {
    this.wake((i) => i.eventId === eventId && i.state === 'closed')
  }

  /** The guest entered the new PIN, or opened the new link. */
  resumeAccess(eventId: string, code: string): void {
    this.codes.set(eventId, code)
    for (const i of this.list) {
      if (i.eventId === eventId && i.code !== code && !i.settled && i.state !== 'needs_access') this.set(i, { code })
    }
    this.wake((i) => i.eventId === eventId && i.state === 'needs_access', { code })
  }

  private wake(which: (i: QueueItem) => boolean, also: Partial<QueueItem> = {}): void {
    for (const item of this.list.filter(which)) this.set(item, { ...also, state: 'waiting', attempts: 0 })
    this.pump()
  }

  private find(clientId: string): QueueItem | undefined {
    return this.list.find((i) => i.clientId === clientId)
  }

  private forget(clientId: string): void {
    this.inMemory.delete(clientId)
    this.notBefore.delete(clientId)
    this.wakeups.get(clientId)?.()
    this.wakeups.delete(clientId)
  }

  private show(): void {
    this.shown = this.list.map((i) => ({ ...i }))
    for (const fn of this.listeners) fn()
  }

  private set(item: QueueItem, change: Partial<QueueItem>): void {
    Object.assign(item, change)
    this.show()
    if (item.persisted && !item.settled) void this.o.store.update({ ...item }).then(() => this.o.channel.post([]), () => {})
  }

  private async reload(): Promise<void> {
    const missed = new Set(this.adding)
    this.addedDuring.add(missed)
    const stored = await this.o.store.list().catch(() => [] as QueueItem[])
    this.addedDuring.delete(missed)
    const kept = new Set(stored.map((i) => i.clientId))
    const here = new Map(this.list.map((i) => [i.clientId, i]))
    // This tab's own finished and in-memory photos aren't in storage.
    const busy = (i: QueueItem) => missed.has(i.clientId)
    const own = this.list.filter((i) => !kept.has(i.clientId) && (i.settled || !i.persisted || busy(i)))
    // While sending, this tab knows best.
    const current = stored.map((i) => (this.leader || busy(i) ? (here.get(i.clientId) ?? i) : i))
    this.list = [...current, ...own].sort((a, b) => a.addedAt - b.addedAt)
    this.show()
  }

  private async heardFromAnotherTab(done: QueueItem[]): Promise<void> {
    for (const item of done) {
      const mine = this.find(item.clientId)
      if (mine) Object.assign(mine, item)
    }
    await this.reload()
    this.pump()
  }

  private async becomeLeader(): Promise<void> {
    if (!this.running) return
    await this.reload()
    if (!this.running) return
    this.leader = true
    for (const item of this.list) {
      // Left over from a page that closed, or worth asking about once more.
      const restart: ItemState[] = ['uploading', 'offline', 'closed', 'needs_access']
      if (restart.includes(item.state) && !this.sending.has(item.clientId)) this.set(item, { state: 'waiting', progress: 0 })
      const code = this.codes.get(item.eventId)
      if (code && code !== item.code) this.set(item, { code })
    }
    this.pump()
    this.schedulePoll()
  }

  private mayStart(item: QueueItem): boolean {
    if (item.settled || this.adding.has(item.clientId) || this.sending.has(item.clientId)) return false
    if (item.state !== 'waiting' && item.state !== 'offline') return false
    if (item.persisted && !this.leader) return false
    return (this.notBefore.get(item.clientId) ?? 0) <= this.o.clock.now()
  }

  private pump(): void {
    if (!this.running) return
    for (const item of this.list) {
      if (this.sending.size >= AT_ONCE) return
      if (!this.mayStart(item)) continue
      if (!this.o.online()) {
        if (item.state !== 'offline') this.set(item, { state: 'offline' })
        this.wakeIn(item, MAX_WAIT_MS)
        continue
      }
      const abort = new AbortController()
      this.sending.set(item.clientId, abort)
      void this.send(item, abort.signal).finally(() => {
        this.sending.delete(item.clientId)
        this.pump()
      })
    }
  }

  private wakeIn(item: QueueItem, ms: number): void {
    this.wakeups.get(item.clientId)?.()
    this.wakeups.set(
      item.clientId,
      this.o.clock.after(ms, () => this.pump()),
    )
  }

  private async send(item: QueueItem, signal: AbortSignal): Promise<void> {
    this.set(item, { state: 'uploading', progress: 0, reason: undefined })
    let step: 'reserve' | 'put' | 'complete' = 'reserve'
    try {
      const reserved = await this.o.transport.reserve({ ...item })
      if (signal.aborted) return
      this.set(item, { photoId: reserved.photoId })
      if (reserved.state !== 'reserved' || !reserved.put) return this.arrived(item, reserved)

      const file = this.inMemory.get(item.clientId) ?? (await this.o.store.file(item.clientId))
      if (!file) return this.set(item, { state: 'failed', reason: 'lost' })
      step = 'put'
      await this.o.transport.put(
        reserved.put.url,
        reserved.put.headers,
        file,
        (sent) => {
          if (signal.aborted) return
          item.progress = item.size ? Math.min(1, sent / item.size) : 0
          this.show()
        },
        signal,
      )
      if (signal.aborted) return
      step = 'complete'
      this.arrived(item, await this.o.transport.complete({ ...item }))
    } catch (err) {
      if (signal.aborted) return
      const e = err instanceof TransportError ? err : new TransportError('internal', 500, String(err))
      this.trouble(item, e, step)
    }
  }

  private trouble(item: QueueItem, e: TransportError, step: 'reserve' | 'put' | 'complete'): void {
    if (step !== 'put') {
      if (e.code === 'frozen') return this.set(item, { state: 'closed' })
      if (e.code === 'pin_required' || e.code === 'not_found') return this.pauseEvent(item)
      // "Didn't arrive in full" is cured by sending it again.
      const again = step === 'complete' && (e.code === 'bad_input' || e.code === 'conflict')
      if (FINAL.has(e.code) && !again) return this.set(item, { state: 'failed', reason: e.code })
    }
    // The upload link may simply have run out, so the next try asks for a new one.
    const attempts = item.attempts + 1
    const wait = Math.min(MAX_WAIT_MS, 1000 * 2 ** (attempts - 1) * (1 + this.o.random()))
    this.notBefore.set(item.clientId, this.o.clock.now() + wait)
    this.set(item, { state: e.status === 0 ? 'offline' : 'waiting', attempts, progress: 0 })
    this.wakeIn(item, wait)
  }

  private pauseEvent(item: QueueItem): void {
    for (const i of this.list) {
      const idle = i.state === 'waiting' || i.state === 'offline'
      if (i === item || (i.eventId === item.eventId && i.code === item.code && idle)) this.set(i, { state: 'needs_access', progress: 0 })
    }
  }

  private arrived(item: QueueItem, r: Pick<Reserved, 'state' | 'reason'>): void {
    this.apply(item, r.state, r.reason)
    this.schedulePoll()
  }

  private apply(item: QueueItem, state: UploadState, reason: string | null): void {
    switch (state) {
      case 'processing':
        if (item.state !== 'added') this.set(item, { state: 'added', progress: 1 })
        return
      case 'live':
      case 'already_added':
      case 'received':
        return this.settle(item, 'added', state)
      case 'pending':
        return this.settle(item, 'waiting_for_host', state)
      case 'removed_by_host':
        return this.set(item, { state: 'failed', reason: 'removed_by_host' })
      case 'failed':
        return this.set(item, { state: 'failed', reason: reason ?? 'internal' })
      case 'reserved':
      case 'expired':
        this.set(item, { state: 'waiting', progress: 0 })
        return this.pump()
    }
  }

  private settle(item: QueueItem, state: ItemState, reason: string): void {
    this.forget(item.clientId)
    this.set(item, { state, reason, progress: 1, settled: true })
    const done = [{ ...item }]
    void this.o.store
      .remove(item.clientId)
      .catch(() => {})
      .then(() => this.o.channel.post(done))
  }

  private tracked(): QueueItem[] {
    return this.list.filter((i) => i.state === 'added' && !i.settled && i.photoId && (this.leader || !i.persisted))
  }

  private schedulePoll(): void {
    if (!this.running || this.cancelPoll || !this.tracked().length) return
    this.cancelPoll = this.o.clock.after(POLL_MS, () => {
      this.cancelPoll = undefined
      void this.poll()
    })
  }

  private async poll(): Promise<void> {
    const waiting = this.tracked()
    if (!this.running || !waiting.length || !this.o.online()) return this.schedulePoll()
    for (const [code, items] of Map.groupBy(waiting, (i) => i.code)) {
      for (let at = 0; at < items.length; at += 100) {
        const batch = items.slice(at, at + 100)
        const answers = await this.o.transport
          .states(
            code,
            batch.map((i) => i.photoId!),
          )
          .catch(() => [])
        for (const a of answers) {
          const item = batch.find((i) => i.photoId === a.photoId)
          if (item && !item.settled) this.apply(item, a.state, a.reason)
        }
      }
    }
    this.schedulePoll()
  }
}
