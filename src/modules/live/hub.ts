import { Client } from 'pg'
import { config } from '@/config'
import type { Viewer } from '@/modules/access/can'
import { CHANNEL, type LiveMessage, type LiveType } from './publish'

export const HEARTS_MS = 2000

type Unlocked = Exclude<Viewer, { kind: 'locked' }>
/** A TV shows what any guest sees, but isn't anyone. */
export type Watcher = Unlocked | { kind: 'tv'; eventId: string }
export type Outgoing = { type: LiveType; ids: string[] }
type Subscriber = { viewer: Watcher; send: (m: Outgoing) => void; close: () => void }

/** Listens to the database once and passes changes to every open screen in this process. */
class Hub {
  private readonly events = new Map<string, Set<Subscriber>>()
  private readonly hearts = new Map<string, Set<string>>()
  private connecting: Promise<void> | undefined
  private client: Client | undefined
  private stopped = false

  /** Resolves once announcements are being received. */
  ready(): Promise<void> {
    this.stopped = false
    this.connecting ??= this.connect()
    return this.connecting
  }

  private async connect(): Promise<void> {
    for (let wait = 250; !this.stopped; wait = Math.min(wait * 2, 5000)) {
      const client = new Client({ connectionString: config.databaseUrl, application_name: 'event-photos-live', keepAlive: true })
      try {
        client.on('error', () => this.lost(client))
        client.on('end', () => this.lost(client))
        client.on('notification', (n) => n.payload && this.receive(n.payload))
        await client.connect()
        await client.query(`listen ${CHANNEL}`)
        this.client = client
        return
      } catch (err) {
        console.error('Live updates could not connect', (err as Error).message)
        await client.end().catch(() => {})
        await new Promise((r) => setTimeout(r, wait))
      }
    }
  }

  /** Changes may have been missed, so every screen is asked to reconnect and catch up. */
  private lost(client: Client): void {
    if (this.client !== client) return
    this.client = undefined
    this.connecting = undefined
    void client.end().catch(() => {})
    for (const group of [...this.events.values()]) for (const s of [...group]) s.close()
    if (!this.stopped) void this.ready()
  }

  private receive(payload: string): void {
    let msg: LiveMessage
    try {
      msg = JSON.parse(payload) as LiveMessage
    } catch {
      return
    }
    const group = this.events.get(msg.eventId)
    if (!group) return
    if (msg.type === 'hearts') return this.gatherHearts(msg)
    for (const s of [...group]) this.deliver(s, msg)
  }

  private deliver(s: Subscriber, msg: LiveMessage): void {
    const host = s.viewer.kind === 'host'
    const named = Array.isArray(msg.audience) && s.viewer.kind === 'guest' && msg.audience.includes(s.viewer.participantId)
    if (msg.audience !== 'everyone' && !host && !named) return
    if (msg.type === 'tv' && s.viewer.kind !== 'tv') return
    s.send({ type: msg.type, ids: msg.ids })
    if (msg.type === 'deleted' || msg.type === 'tv' || (msg.type === 'access' && s.viewer.kind === 'guest')) s.close()
  }

  private gatherHearts(msg: LiveMessage): void {
    const waiting = this.hearts.get(msg.eventId)
    if (waiting) {
      for (const id of msg.ids) waiting.add(id)
      return
    }
    this.hearts.set(msg.eventId, new Set(msg.ids))
    setTimeout(() => {
      const ids = [...(this.hearts.get(msg.eventId) ?? [])]
      this.hearts.delete(msg.eventId)
      for (const s of [...(this.events.get(msg.eventId) ?? [])]) this.deliver(s, { ...msg, ids })
    }, HEARTS_MS)
  }

  subscribe(eventId: string, viewer: Watcher, to: Omit<Subscriber, 'viewer'>): () => void {
    void this.ready()
    const group = this.events.get(eventId) ?? new Set()
    this.events.set(eventId, group)
    const s: Subscriber = { viewer, ...to }
    group.add(s)
    return () => {
      group.delete(s)
      if (!group.size && this.events.get(eventId) === group) this.events.delete(eventId)
    }
  }

  count(eventId: string): number {
    return this.events.get(eventId)?.size ?? 0
  }

  async stop(): Promise<void> {
    this.stopped = true
    const client = this.client
    this.client = undefined
    this.connecting = undefined
    await client?.end().catch(() => {})
  }
}

const shared = globalThis as unknown as { __hub?: Hub }

/** Kept on globalThis because Next.js may load this file once per route. */
export function getHub(): Hub {
  shared.__hub ??= new Hub()
  return shared.__hub
}
