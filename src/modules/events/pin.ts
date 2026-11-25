import { and, eq, isNull, lt, or, sql } from 'drizzle-orm'
import { user } from '@/db/auth-schema'
import { db, type Executor } from '@/db/client'
import { events, type EventRow } from '@/db/schema'
import { AppError } from '@/lib/errors'
import { hmacHex, safeEqual } from '@/lib/ids'
import { sendMail } from '@/lib/mail'
import { countHit, hitLimit, refundHit } from '@/lib/rate-limit'
import { publish } from '@/modules/live/publish'
import { unlockGuest } from '@/modules/access/viewer'

export const PIN_FORMAT = /^[0-9]{4}$/

const QUARTER_HOUR = 15 * 60
const HOUR = 60 * 60
const PAUSE_MS = 10 * 60 * 1000

const pinHash = (eventId: string, pin: string) => hmacHex(`pin:${eventId}:${pin}`)

export function pinMatches(event: Pick<EventRow, 'id' | 'pinHash'>, pin: string): boolean {
  return event.pinHash !== null && safeEqual(event.pinHash, pinHash(event.id, pin))
}

/** Sets or removes the PIN. Either way, guests who were inside must unlock again if one is set. */
export async function setPin(tx: Executor, eventId: string, pin: string | null): Promise<void> {
  if (pin !== null && !PIN_FORMAT.test(pin)) throw new AppError('bad_input', 'A PIN is 4 digits.')
  await tx
    .update(events)
    .set({
      pinHash: pin === null ? null : pinHash(eventId, pin),
      pinVersion: sql`${events.pinVersion} + 1`,
      pinPausedUntil: null,
      tvPinEncrypted: null,
      settings: sql`jsonb_set(${events.settings}, '{tv,showPin}', 'false')`,
    })
    .where(eq(events.id, eventId))
  await publish(tx, { eventId, type: 'access', ids: [], audience: 'everyone' })
}

async function pauseEvent(event: EventRow): Promise<void> {
  const now = new Date()
  const [paused] = await db
    .update(events)
    .set({ pinPausedUntil: new Date(now.getTime() + PAUSE_MS) })
    .where(and(eq(events.id, event.id), or(isNull(events.pinPausedUntil), lt(events.pinPausedUntil, now))))
    .returning({ ownerId: events.ownerId })
  if (!paused?.ownerId || !(await hitLimit(`pin:mail:${event.id}`, 1, HOUR))) return
  const [owner] = await db.select({ email: user.email }).from(user).where(eq(user.id, paused.ownerId))
  if (!owner) return
  await sendMail({
    to: owner.email,
    subject: `Someone is guessing the PIN for ${event.name}`,
    text: `There were many wrong PINs for ${event.name}, so new PIN entries are paused for 10 minutes. Guests already inside aren't affected.\n\nIf you didn't expect this, you can change the event link in Settings.`,
  })
}

/**
 * Lets a guest in, or throws. Attempts are counted before the answer is known
 * and given back when right, so sending many at once can't beat the limits.
 */
export async function tryPin(event: EventRow, guestTokenHash: string, ip: string, pin: string): Promise<void> {
  if (!PIN_FORMAT.test(pin)) throw new AppError('bad_input', 'A PIN is 4 digits.')
  if (!event.pinHash) return
  if (event.pinPausedUntil && event.pinPausedUntil > new Date()) throw new AppError('pin_paused')

  const guestKey = `pin:guest:${event.id}:${guestTokenHash}`
  const ipKey = `pin:ip:${ip}`
  if (!(await hitLimit(guestKey, 5, QUARTER_HOUR))) throw new AppError('rate_limited')
  if (!(await hitLimit(ipKey, 100, HOUR))) {
    await refundHit(guestKey, QUARTER_HOUR)
    throw new AppError('rate_limited')
  }

  if (!pinMatches(event, pin)) {
    const wrong = await countHit(`pin:event:${event.id}`, HOUR)
    if (wrong >= 500) await pauseEvent(event)
    throw new AppError('pin_wrong')
  }

  await refundHit(guestKey, QUARTER_HOUR)
  await refundHit(ipKey, HOUR)
  await unlockGuest(event.id, guestTokenHash, event.pinVersion)
}
