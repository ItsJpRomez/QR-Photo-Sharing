import type { Clock, LeaderLock, QueueStore } from './types'

const LEASE_MS = 6000
const RENEW_MS = 2000

/** A short claim kept alive in storage, for browsers without Web Locks. */
export class LeaseLock implements LeaderLock {
  constructor(
    private readonly store: QueueStore,
    private readonly clock: Clock,
    private readonly owner: string,
  ) {}

  request(onHeld: () => void): () => void {
    let held = false
    let stopped = false
    let cancel = () => {}
    const tick = async () => {
      const mine = await this.store.claim(this.owner, this.clock.now(), LEASE_MS).catch(() => false)
      if (stopped) return
      if (mine && !held) {
        held = true
        onHeld()
      }
      cancel = this.clock.after(RENEW_MS, () => void tick())
    }
    void tick()
    return () => {
      stopped = true
      cancel()
      void this.store.release(this.owner).catch(() => {})
    }
  }
}

/** The browser's own lock, which is let go even if the tab crashes. */
export class WebLock implements LeaderLock {
  request(onHeld: () => void): () => void {
    const abort = new AbortController()
    let letGo = () => {}
    navigator.locks
      .request('upload-queue', { signal: abort.signal }, () => {
        onHeld()
        return new Promise<void>((resolve) => {
          letGo = resolve
        })
      })
      .catch(() => {})
    return () => {
      abort.abort()
      letGo()
    }
  }
}
