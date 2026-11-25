import { fromZonedTime } from 'date-fns-tz'

const DAY_MS = 24 * 3600_000

type Input = { takenLocal: string | null; offset: string | null; timeZone: string; uploadedAt: Date }

/** When a photo was taken. Cameras rarely record a time zone, so the event's is assumed. */
export function resolveTakenAt({ takenLocal, offset, timeZone, uploadedAt }: Input): Date {
  const m = /^(\d{4})[:-](\d{2})[:-](\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(takenLocal ?? '')
  if (!m) return uploadedAt
  const [, y, mo, d, h, mi, s] = m
  const iso = `${y}-${mo}-${d}T${h}:${mi}:${s}`
  if (Number(y) < 1970 || Number.isNaN(Date.parse(`${iso}Z`))) return uploadedAt
  const zone = offset && /^[+-](0\d|1[0-4]):[0-5]\d$/.test(offset) ? offset : timeZone
  const taken = fromZonedTime(iso, zone)
  if (Number.isNaN(taken.getTime()) || taken.getTime() - uploadedAt.getTime() > DAY_MS) return uploadedAt
  return taken
}
