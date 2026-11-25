import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { beforeEach, describe, expect, test } from 'vitest'
import { LeaseLock } from '@/features/upload-queue/lock'
import { UploadQueue, type QueueOptions } from '@/features/upload-queue/queue'
import { IdbStore } from '@/features/upload-queue/store'
import { TransportError, type Channel, type Clock, type LeaderLock, type QueueItem, type Reserved, type TabMessage, type Transport, type UploadState } from '@/features/upload-queue/types'

const META = { albumId: null, tags: [] }
const TO = { eventId: 'E', code: 'CODE' }
const file = (name = 'a.jpg', size = 10) => new File(['x'.repeat(size)], name, { type: 'image/jpeg' })

class TestClock implements Clock {
  time = 1_000_000
  private timers: { at: number; fn: () => void }[] = []
  now = () => this.time
  after = (ms: number, fn: () => void) => {
    const t = { at: this.time + ms, fn }
    this.timers.push(t)
    return () => void (this.timers = this.timers.filter((x) => x !== t))
  }
  async advance(ms: number) {
    await settle() // let anything already under way finish first
    const end = this.time + ms
    for (;;) {
      const due = this.timers.filter((t) => t.at <= end).sort((a, b) => a.at - b.at)[0]
      if (!due) break
      this.time = Math.max(this.time, due.at)
      this.timers = this.timers.filter((t) => t !== due)
      due.fn()
      await settle()
    }
    this.time = end
    await settle()
  }
}

async function settle() {
  for (let i = 0; i < 25; i++) await new Promise((r) => setTimeout(r, 0))
}

type Fail = TransportError | undefined

class FakeServer implements Transport {
  log: string[] = []
  photos = new Map<string, { photoId: string; state: UploadState; reason: string | null; got: number }>()
  failReserve: ((i: QueueItem) => Fail) | undefined
  failPut: ((url: string) => Fail) | undefined
  failComplete: ((i: QueueItem) => Fail) | undefined
  afterComplete: UploadState = 'live'
  hold: Promise<void> | undefined
  inFlight = 0
  most = 0
  onReserve: ((i: QueueItem) => void | Promise<void>) | undefined

  private find(i: QueueItem) {
    let p = this.photos.get(i.clientId)
    if (!p) this.photos.set(i.clientId, (p = { photoId: `p-${i.clientId}`, state: 'reserved', reason: null, got: 0 }))
    return p
  }
  async reserve(i: QueueItem): Promise<Reserved> {
    this.log.push(`reserve ${i.fileName}`)
    await this.onReserve?.(i)
    const f = this.failReserve?.(i)
    if (f) throw f
    const p = this.find(i)
    if (p.state === 'failed' || p.state === 'expired') Object.assign(p, { state: 'reserved', reason: null })
    return { ...p, put: p.state === 'reserved' ? { url: `up://${i.clientId}`, headers: {} } : undefined }
  }
  async put(url: string, _h: Record<string, string>, body: Blob, onProgress: (n: number) => void, signal: AbortSignal) {
    this.log.push(`put ${url}`)
    this.inFlight++
    this.most = Math.max(this.most, this.inFlight)
    try {
      onProgress(Math.floor(body.size / 2))
      if (this.hold) await Promise.race([this.hold, new Promise((_, no) => signal.addEventListener('abort', () => no(new TransportError('aborted', 0))))])
      const f = this.failPut?.(url)
      if (f) throw f
      this.photos.get(url.slice(5))!.got += body.size
    } finally {
      this.inFlight--
    }
  }
  async complete(i: QueueItem): Promise<Reserved> {
    this.log.push(`complete ${i.fileName}`)
    const f = this.failComplete?.(i)
    if (f) throw f
    const p = this.find(i)
    p.state = 'processing'
    return { ...p }
  }
  async states(_code: string, ids: string[]) {
    return [...this.photos.values()]
      .filter((p) => ids.includes(p.photoId))
      .map((p) => {
        if (p.state === 'processing') p.state = this.afterComplete
        return { photoId: p.photoId, state: p.state, reason: p.reason }
      })
  }
  set(clientId: string, state: UploadState, reason: string | null = null) {
    Object.assign(this.photos.get(clientId)!, { state, reason })
  }
}

const freeLock: LeaderLock = { request: (held) => (held(), { release: () => {}, steal: () => {} }) }

/** Works like the browser's lock: one holder, others wait in line, and it can be taken. */
class SharedLock {
  private line: { held: () => void; lost: () => void }[] = []
  tab(): LeaderLock {
    return {
      request: (held, lost = () => {}) => {
        const me = { held, lost }
        this.line.push(me)
        if (this.line.length === 1) held()
        const leave = () => {
          const first = this.line[0] === me
          this.line = this.line.filter((x) => x !== me)
          if (first) this.line[0]?.held()
        }
        return {
          release: leave,
          steal: () => {
            if (this.line[0] === me) return
            const old = this.line.shift()
            this.line = [me, ...this.line.filter((x) => x !== me)]
            old?.lost()
            held()
          },
        }
      },
    }
  }
}

let clock: TestClock
let server: FakeServer
let store: IdbStore
let online: boolean
let bus: Set<(m: TabMessage) => void>
const channel = (): Channel => {
  const mine = new Set<(m: TabMessage) => void>()
  return {
    post: (m) => [...bus].filter((f) => !mine.has(f)).forEach((f) => f(m)),
    listen: (fn) => (mine.add(fn), bus.add(fn), () => bus.delete(fn)),
  }
}
const make = (over: Partial<QueueOptions> = {}) =>
  new UploadQueue({ store, transport: server, clock, random: () => 0.5, online: () => online, visible: () => true, lock: freeLock, channel: channel(), ...over })
const states = (q: UploadQueue) => q.items().map((i) => i.state)

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory()
  clock = new TestClock()
  server = new FakeServer()
  store = new IdbStore()
  online = true
  bus = new Set()
})

describe('nothing is lost', () => {
  test('a photo is kept on the phone before any network call', async () => {
    const q = make()
    q.start()
    let keptFirst = false
    server.onReserve = async (i) => {
      keptFirst = (await (await store.file(i.clientId))!.text()) === 'x'.repeat(10)
    }
    expect(await q.add([file()], TO, META)).toEqual({ persisted: true })
    await settle()
    expect(keptFirst).toBe(true)
  })

  test('a new page carries on where the last one stopped, once', async () => {
    const q1 = make()
    q1.start()
    server.hold = new Promise(() => {})
    await q1.add([file('a.jpg'), file('b.jpg'), file('c.jpg')], TO, META)
    await settle()
    q1.stop()
    await settle()
    server.hold = undefined
    const q2 = make()
    q2.start()
    await clock.advance(30_000)
    expect(states(q2)).toEqual(['added', 'added', 'added'])
    expect([...server.photos.values()].map((p) => p.got)).toEqual([10, 10, 10])
    expect(await store.list()).toEqual([])
  })

  test('the file stays until the server is truly done with it', async () => {
    const q = make()
    q.start()
    server.afterComplete = 'processing'
    await q.add([file()], TO, META)
    await settle()
    const [i] = q.items()
    expect(i).toMatchObject({ state: 'added', settled: false })
    expect(await store.file(i!.clientId)).not.toBeNull()
    server.afterComplete = 'live'
    await clock.advance(20_000)
    expect(q.items()[0]).toMatchObject({ state: 'added', settled: true })
    expect(await store.file(i!.clientId)).toBeNull()
  })

  test.each(['live', 'already_added', 'received'] as const)('%s means added', async (s) => {
    const q = make()
    q.start()
    server.afterComplete = s
    await q.add([file()], TO, META)
    await clock.advance(20_000)
    expect(q.items()[0]).toMatchObject({ state: 'added', settled: true })
  })

  test('pending means waiting for the host', async () => {
    const q = make()
    q.start()
    server.afterComplete = 'pending'
    await q.add([file()], TO, META)
    await clock.advance(20_000)
    expect(q.items()[0]).toMatchObject({ state: 'waiting_for_host', settled: true })
  })

  test('a photo that fails later says so, and can be tried again', async () => {
    const q = make()
    q.start()
    server.afterComplete = 'failed'
    await q.add([file()], TO, META)
    await clock.advance(20_000)
    const [i] = q.items()
    expect(i!.state).toBe('failed')
    expect(await store.file(i!.clientId)).not.toBeNull()
    server.afterComplete = 'live'
    q.retry(i!.clientId)
    await clock.advance(20_000)
    expect(q.items()[0]).toMatchObject({ state: 'added', settled: true })
  })

  test('a reservation that ran out starts over by itself', async () => {
    const q = make()
    q.start()
    server.afterComplete = 'processing'
    await q.add([file()], TO, META)
    await settle()
    server.set(q.items()[0]!.clientId, 'expired')
    server.afterComplete = 'live'
    await clock.advance(30_000)
    expect(q.items()[0]).toMatchObject({ state: 'added', settled: true })
  })

  test('with storage full, it still uploads and says it is not kept', async () => {
    const q = make()
    q.start()
    store.add = async () => {
      throw new DOMException('full', 'QuotaExceededError')
    }
    expect(await q.add([file()], TO, META)).toEqual({ persisted: false })
    await clock.advance(20_000)
    expect(q.items()[0]).toMatchObject({ state: 'added', persisted: false })
  })

  test('a photo added while the queue is being read is not forgotten', async () => {
    const q = make()
    const list = store.list
    let open!: () => void
    const gate = new Promise<void>((r) => (open = r))
    store.list = async () => {
      const before = await list.call(store)
      await gate
      return before
    }
    q.start()
    await settle()
    await q.add([file()], TO, META)
    open()
    await settle()
    expect(q.items()).toHaveLength(1)
    await clock.advance(20_000)
    expect(states(q)).toEqual(['added'])
  })

  test('removing one before it is sent really removes it', async () => {
    const q = make()
    q.start()
    server.hold = new Promise(() => {})
    await q.add([file()], TO, META)
    await settle()
    await q.remove(q.items()[0]!.clientId)
    await settle()
    expect(q.items()).toEqual([])
    expect(await store.list()).toEqual([])
    await clock.advance(120_000)
    expect(server.log.filter((l) => l.startsWith('complete'))).toEqual([])
  })
})

describe('bad signal', () => {
  test('two at a time, in order', async () => {
    const q = make()
    q.start()
    let go!: () => void
    server.hold = new Promise((r) => (go = r))
    await q.add(Array.from({ length: 5 }, (_, n) => file(`${n}.jpg`)), TO, META)
    await settle()
    expect(states(q)).toEqual(['uploading', 'uploading', 'waiting', 'waiting', 'waiting'])
    expect(q.items()[0]!.progress).toBe(0.5)
    server.hold = undefined
    go()
    await clock.advance(30_000)
    expect(server.most).toBe(2)
    expect(server.log.filter((l) => l.startsWith('complete'))).toEqual([0, 1, 2, 3, 4].map((n) => `complete ${n}.jpg`))
  })

  test.each([0, 0.999])('waits grow 1-2 s, 2-4 s, 4-8 s and stop at a minute (random %f)', async (r) => {
    const q = make({ random: () => r })
    q.start()
    server.failPut = () => new TransportError('offline', 0)
    await q.add([file()], TO, META)
    await settle()
    const tries = () => server.log.filter((l) => l.startsWith('put')).length
    expect(tries()).toBe(1)
    let n = 1
    for (const base of [1000, 2000, 4000, 8000, 16000, 32000, 60000, 60000]) {
      const wait = Math.min(60_000, base === 60_000 ? 60_000 : base * (1 + r))
      await clock.advance(wait - 20)
      expect(tries(), `before ${wait}`).toBe(n)
      await clock.advance(20)
      expect(tries(), `at ${wait}`).toBe(++n)
    }
  })

  test('no connection is said plainly, and a nudge retries at once', async () => {
    const q = make()
    q.start()
    online = false
    await q.add([file()], TO, META)
    await settle()
    expect(states(q)).toEqual(['offline'])
    expect(server.log).toEqual([])
    online = true
    q.nudge()
    await clock.advance(4000)
    expect(states(q)).toEqual(['added'])
  })

  test('a drop in the middle is not "added"', async () => {
    const q = make()
    q.start()
    server.failPut = () => new TransportError('offline', 0)
    await q.add([file()], TO, META)
    await settle()
    expect(states(q)).toEqual(['offline'])
    server.failPut = undefined
    server.failComplete = () => new TransportError('offline', 0)
    q.nudge()
    await settle()
    expect(states(q)).toEqual(['offline'])
    server.failComplete = undefined
    q.nudge()
    await clock.advance(10_000)
    expect(states(q)).toEqual(['added'])
  })

  test('an upload link that ran out is renewed under the same id', async () => {
    const q = make()
    q.start()
    let first = true
    server.failPut = () => (first ? ((first = false), new TransportError('expired', 403)) : undefined)
    await q.add([file()], TO, META)
    await clock.advance(10_000)
    expect(states(q)).toEqual(['added'])
    expect(server.photos.size).toBe(1)
    expect(server.log.filter((l) => l.startsWith('reserve'))).toHaveLength(2)
  })

  test.each(['rate_limited', 'internal', 'bad_gateway'])('%s is tried again', async (code) => {
    const q = make()
    q.start()
    let n = 0
    server.failReserve = () => (n++ < 2 ? new TransportError(code, code === 'rate_limited' ? 429 : 502) : undefined)
    await q.add([file()], TO, META)
    await settle()
    expect(states(q)).toEqual(['waiting'])
    await clock.advance(30_000)
    expect(states(q)).toEqual(['added'])
  })

  test('a file that arrived cut short is sent again', async () => {
    const q = make()
    q.start()
    let first = true
    server.failComplete = () => (first ? ((first = false), new TransportError('bad_input', 400)) : undefined)
    await q.add([file()], TO, META)
    await clock.advance(20_000)
    expect(states(q)).toEqual(['added'])
    expect(server.log.filter((l) => l.startsWith('put'))).toHaveLength(2)
  })
})

test('a timer that fires a hair early does not strand a photo', async () => {
  // Browsers round timers and clocks differently, so a wake-up can come before its time.
  const early: Clock = { now: clock.now, after: (ms, fn) => clock.after(Math.max(0, ms - 1), fn) }
  const q = make({ clock: early })
  q.start()
  server.failPut = () => new TransportError('offline', 0)
  await q.add([file()], TO, META)
  await settle()
  expect(states(q)).toEqual(['offline'])
  server.failPut = undefined
  await clock.advance(30_000)
  expect(states(q)).toEqual(['added'])
})

describe('answers that end it', () => {
  test.each(['bad_type', 'too_large', 'gallery_full', 'guest_limit', 'removed_by_host', 'conflict'])('%s fails without retrying', async (code) => {
    const q = make()
    q.start()
    server.failReserve = () => new TransportError(code, 409)
    await q.add([file()], TO, META)
    await clock.advance(120_000)
    expect(q.items()[0]).toMatchObject({ state: 'failed', reason: code })
    expect(server.log).toEqual(['reserve a.jpg'])
  })

  test('one bad photo does not hold up the rest', async () => {
    const q = make()
    q.start()
    server.failReserve = (i) => (i.fileName === 'bad.jpg' ? new TransportError('too_large', 413) : undefined)
    await q.add([file('bad.jpg'), file('ok.jpg')], TO, META)
    await clock.advance(20_000)
    expect(states(q)).toEqual(['failed', 'added'])
  })

  test('closed uploads wait, and resume when the host reopens', async () => {
    const q = make()
    q.start()
    server.failReserve = () => new TransportError('frozen', 409)
    await q.add([file()], TO, META)
    await settle()
    expect(states(q)).toEqual(['closed'])
    await clock.advance(600_000)
    expect(server.log).toHaveLength(1)
    server.failReserve = undefined
    q.reopen('E')
    await clock.advance(10_000)
    expect(states(q)).toEqual(['added'])
  })
})

describe('the PIN or link changes while photos wait', () => {
  test.each([
    ['pin_required', 401],
    ['not_found', 404],
  ])('%s pauses with every file kept, then finishes with the new link', async (code, status) => {
    const q = make()
    q.start()
    server.failReserve = (i) => (i.code === 'CODE' ? new TransportError(code, status) : undefined)
    await q.add([file('a.jpg'), file('b.jpg'), file('c.jpg')], TO, META)
    await clock.advance(60_000)
    expect(states(q)).toEqual(['needs_access', 'needs_access', 'needs_access'])
    expect(await store.list()).toHaveLength(3)
    q.resumeAccess('E', 'NEWCODE')
    await clock.advance(30_000)
    expect(states(q)).toEqual(['added', 'added', 'added'])
  })

  test('opening the new link on a fresh page finishes them, even if the page is quicker than the queue', async () => {
    const q1 = make()
    q1.start()
    server.failReserve = (i) => (i.code === 'CODE' ? new TransportError('not_found', 404) : undefined)
    await q1.add([file('a.jpg'), file('b.jpg')], TO, META)
    await clock.advance(5000)
    q1.stop()
    const q2 = make()
    q2.resumeAccess('E', 'NEWCODE')
    q2.start()
    await clock.advance(30_000)
    expect(states(q2)).toEqual(['added', 'added'])
  })

  test('another event is not disturbed', async () => {
    const q = make()
    q.start()
    server.failReserve = (i) => (i.eventId === 'E' ? new TransportError('pin_required', 401) : undefined)
    await q.add([file('a.jpg')], TO, META)
    await q.add([file('b.jpg')], { eventId: 'F', code: 'OTHER' }, META)
    await clock.advance(20_000)
    expect(states(q)).toEqual(['needs_access', 'added'])
  })
})

describe('two tabs', () => {
  test('with a lease, each photo is sent once and the other tab sees it finish', async () => {
    const tab = (id: string) => make({ lock: new LeaseLock(store, clock, id), channel: channel() })
    const [a, b] = [tab('a'), tab('b')]
    a.start()
    await settle()
    b.start()
    await settle()
    await b.add([file('1.jpg'), file('2.jpg')], TO, META)
    await clock.advance(30_000)
    expect([...server.photos.values()].map((p) => p.got)).toEqual([10, 10])
    expect(states(b)).toEqual(['added', 'added'])
  })

  test('if the sending tab goes away, the other takes over', async () => {
    let alive = true
    // A tab that is gone: nothing it planned ever happens.
    const dying: Clock = { now: clock.now, after: (ms, fn) => clock.after(ms, () => alive && fn()) }
    const a = make({ clock: dying, lock: new LeaseLock(store, dying, 'a'), channel: channel() })
    const b = make({ lock: new LeaseLock(store, clock, 'b'), channel: channel() })
    a.start()
    await settle()
    b.start()
    server.hold = new Promise(() => {})
    await a.add([file()], TO, META)
    await settle()
    alive = false
    server.hold = undefined
    await clock.advance(30_000)
    expect(states(b)).toEqual(['added'])
    expect([...server.photos.values()].map((p) => p.got)).toEqual([10])
  })
})

test('saving many photos reports progress, so the page can ask not to be closed yet', async () => {
  const q = make()
  const seen: [number, boolean][] = []
  expect(q.isSaving()).toBe(false)
  await q.add([file('a'), file('b'), file('c')], TO, META, (n) => seen.push([n, q.isSaving()]))
  expect(seen).toEqual([
    [1, true],
    [2, true],
    [3, true],
  ])
  expect(q.isSaving()).toBe(false)
})

describe('what is done in one tab counts in all', () => {
  let lock: SharedLock
  let front: 'a' | 'b'
  const tab = (id: 'a' | 'b', over: Partial<QueueOptions> = {}) => make({ lock: lock.tab(), channel: channel(), visible: () => front === id, ...over })
  beforeEach(() => {
    lock = new SharedLock()
    front = 'a'
  })

  test.each([
    ['pin_required', 401, 'CODE'],
    ['not_found', 404, 'NEWCODE'],
  ])('%s: entering in the second tab lets the first one carry on', async (error, status, code) => {
    let shut = true
    server.failReserve = (i) => (shut || i.code !== code ? new TransportError(error, status) : undefined)
    const a = tab('a')
    const b = tab('b')
    a.start()
    await settle()
    b.start()
    await settle()
    await a.add([file()], TO, META)
    await clock.advance(5000)
    expect(states(a)).toEqual(['needs_access'])
    shut = false
    b.resumeAccess('E', code)
    await clock.advance(20_000)
    expect(states(a)).toEqual(['added'])
    expect(states(b)).toEqual(['added'])
    expect([...server.photos.values()].map((p) => p.got)).toEqual([10])
  })

  test('try again, remove and reopening work from the second tab', async () => {
    const [a, b] = [tab('a'), tab('b')]
    a.start()
    await settle()
    b.start()
    await settle()
    server.failReserve = (i) => (i.fileName === 'full.jpg' ? new TransportError('gallery_full', 409) : i.fileName === 'shut.jpg' ? new TransportError('frozen', 409) : undefined)
    await a.add([file('full.jpg'), file('shut.jpg')], TO, META)
    await clock.advance(5000)
    expect(states(a)).toEqual(['failed', 'closed'])
    server.failReserve = undefined
    b.retry(b.items()[0]!.clientId)
    b.reopen('E')
    await clock.advance(20_000)
    expect(states(a)).toEqual(['added', 'added'])

    server.hold = new Promise(() => {})
    await a.add([file('gone.jpg')], TO, META)
    await settle()
    await b.remove(b.items().find((i) => i.fileName === 'gone.jpg')!.clientId)
    await clock.advance(120_000)
    expect(a.items().some((i) => i.fileName === 'gone.jpg')).toBe(false)
    expect(server.log).not.toContain('complete gone.jpg')
  })

  test('the tab in front does the sending', async () => {
    const [a, b] = [tab('a'), tab('b')]
    a.start()
    await settle()
    front = 'b'
    b.start()
    b.comeToFront()
    await clock.advance(5000)
    expect([a.isSender(), b.isSender()]).toEqual([false, true])
    await b.add([file()], TO, META)
    await clock.advance(10_000)
    expect(states(b)).toEqual(['added'])
    front = 'a'
    a.comeToFront()
    await clock.advance(5000)
    expect([a.isSender(), b.isSender()]).toEqual([true, false])
  })

  test('a frozen tab that cannot answer is taken over from, and each photo still arrives once', async () => {
    let frozen = false
    const deaf: Channel = { post: (m) => !frozen && plain.post(m), listen: (fn) => plain.listen((m) => !frozen && fn(m)) }
    const plain = channel()
    const a = make({ lock: lock.tab(), channel: deaf, visible: () => false, clock: { now: clock.now, after: (ms, fn) => clock.after(ms, () => !frozen && fn()) } })
    const b = tab('b')
    a.start()
    await settle()
    server.hold = new Promise(() => {})
    await a.add([file()], TO, META)
    await settle()
    frozen = true
    front = 'b'
    b.start()
    await settle()
    server.hold = undefined
    b.comeToFront()
    await clock.advance(30_000)
    expect(b.isSender()).toBe(true)
    expect(states(b)).toEqual(['added'])
    expect([...server.photos.values()].map((p) => p.got)).toEqual([10])
  })

  test('a visible sender is left alone', async () => {
    const [a, b] = [tab('a'), tab('b')]
    a.start()
    await settle()
    b.start()
    b.comeToFront()
    await clock.advance(5000)
    expect([a.isSender(), b.isSender()]).toEqual([true, false])
  })
})

test('older iPhones, without Map.groupBy, hear how a photo ended', async () => {
  const groupBy = Map.groupBy
  // @ts-expect-error as it is before iOS 17.4
  delete Map.groupBy
  try {
    const q = make()
    q.start()
    server.afterComplete = 'failed'
    await q.add([file()], TO, META)
    await clock.advance(20_000)
    expect(states(q)).toEqual(['failed'])
  } finally {
    Map.groupBy = groupBy
  }
})

test('a file the phone cannot read says so, instead of blaming the signal', async () => {
  const q = make()
  q.start()
  const bad = file('cloud.jpg')
  bad.arrayBuffer = async () => {
    throw new DOMException('gone', 'NotReadableError')
  }
  expect(await q.add([bad, file('ok.jpg')], TO, META)).toEqual({ persisted: true })
  await clock.advance(20_000)
  expect(q.items().map((i) => [i.fileName, i.state, i.reason])).toEqual([
    ['cloud.jpg', 'failed', 'unreadable'],
    ['ok.jpg', 'added', 'live'],
  ])
})

test('if the phone closes the storage behind us, it is opened again', async () => {
  const q = make()
  q.start()
  await q.add([file('one.jpg')], TO, META)
  await clock.advance(10_000)
  const inside = store as unknown as { db(): Promise<{ close(): void }> }
  ;(await inside.db()).close() // as the phone does, without telling us
  await q.add([file('two.jpg')], TO, META)
  await clock.advance(10_000)
  expect(q.items().map((i) => [i.state, i.persisted])).toEqual([
    ['added', true],
    ['added', true],
  ])
})

test('200 photos are stored one at a time, and read back only when sent', async () => {
  const q = make()
  let writing = 0
  let most = 0
  let reads = 0
  const { add, file: read } = store
  store.add = async (i, f) => {
    most = Math.max(most, ++writing)
    await add.call(store, i, f)
    writing--
  }
  store.file = (id) => (reads++, read.call(store, id))
  await q.add(Array.from({ length: 200 }, (_, n) => file(`${n}.jpg`, 1)), TO, META)
  expect(most).toBe(1)
  expect(reads).toBe(0)
  server.hold = new Promise(() => {})
  q.start()
  await settle()
  expect(reads).toBe(2)
})
