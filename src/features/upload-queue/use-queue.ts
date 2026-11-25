'use client'

import { useEffect, useSyncExternalStore } from 'react'
import { LeaseLock, WebLock } from './lock'
import { UploadQueue } from './queue'
import { IdbStore } from './store'
import { httpTransport } from './transport'
import type { Channel, Clock, QueueItem } from './types'

const clock: Clock = {
  now: () => Date.now(),
  after: (ms, fn) => {
    const t = setTimeout(fn, ms)
    return () => clearTimeout(t)
  },
}

function tabChannel(): Channel {
  if (typeof BroadcastChannel === 'undefined') return { post: () => {}, listen: () => () => {} }
  const bus = new BroadcastChannel('upload-queue')
  return {
    post: (done) => bus.postMessage(done),
    listen: (fn) => {
      const on = (e: MessageEvent<QueueItem[]>) => fn(e.data)
      bus.addEventListener('message', on)
      return () => bus.removeEventListener('message', on)
    },
  }
}

let queue: UploadQueue | undefined

/** The one queue of this tab. */
export function getQueue(): UploadQueue {
  if (!queue) {
    const store = new IdbStore()
    const lock = 'locks' in navigator ? new WebLock() : new LeaseLock(store, clock, crypto.randomUUID())
    queue = new UploadQueue({
      store,
      lock,
      clock,
      transport: httpTransport,
      random: Math.random,
      online: () => navigator.onLine,
      channel: tabChannel(),
    })
  }
  return queue
}

const NONE: readonly QueueItem[] = []

export function useQueueItems(): readonly QueueItem[] {
  return useSyncExternalStore(
    (fn) => getQueue().subscribe(fn),
    () => getQueue().items(),
    () => NONE,
  )
}

/** Keeps the queue running while any event page is open. */
export function useRunQueue(): void {
  useEffect(() => {
    const q = getQueue()
    q.start()
    const nudge = () => q.nudge()
    const ifVisible = () => document.visibilityState === 'visible' && q.nudge()
    const warn = (e: BeforeUnloadEvent) => {
      if (q.isSaving() || q.items().some((i) => !i.persisted && !i.settled && i.state !== 'failed')) e.preventDefault()
    }
    window.addEventListener('online', nudge)
    window.addEventListener('offline', nudge)
    window.addEventListener('pageshow', nudge)
    document.addEventListener('visibilitychange', ifVisible)
    window.addEventListener('beforeunload', warn)
    return () => {
      window.removeEventListener('online', nudge)
      window.removeEventListener('offline', nudge)
      window.removeEventListener('pageshow', nudge)
      document.removeEventListener('visibilitychange', ifVisible)
      window.removeEventListener('beforeunload', warn)
    }
  }, [])
}
