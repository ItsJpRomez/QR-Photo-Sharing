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

  request(onHeld: () => void, onLost: () => void = () => {}) {
    let held = false
    let stopped = false
    let cancel = () => {}
    const tick = async (byForce = false) => {
      const mine = await this.store.claim(this.owner, this.clock.now(), LEASE_MS, byForce).catch(() => false)
      if (stopped) return
      if (mine !== held) {
        held = mine
        if (mine) onHeld()
        else onLost()
      }
      cancel()
      cancel = this.clock.after(RENEW_MS, () => void tick())
    }
    void tick()
    return {
      release: () => {
        stopped = true
        cancel()
        void this.store.release(this.owner).catch(() => {})
      },
      steal: () => void tick(true),
    }
  }
}

/** The browser's own lock, which is let go even if the tab crashes. */
export class WebLock implements LeaderLock {
  request(onHeld: () => void, onLost: () => void = () => {}) {
    const waiting = new AbortController()
    let released = false
    let held = false
    let letGo = () => {}
    const ask = (options: LockOptions) =>
      navigator.locks
        .request('upload-queue', options, () => {
          if (released || held) return
          held = true
          onHeld()
          return new Promise<void>((resolve) => {
            letGo = resolve
          })
        })
        .catch(() => {
          // Another tab took it.
          if (!held || released) return
          held = false
          onLost()
        })
    void ask({ signal: waiting.signal })
    return {
      release: () => {
        released = true
        waiting.abort()
        letGo()
      },
      steal: () => {
        if (!held && !released) void ask({ steal: true })
      },
    }
  }
}
