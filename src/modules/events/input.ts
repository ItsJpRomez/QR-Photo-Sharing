import { z } from 'zod'
import { plainText } from '@/lib/text'

export const eventName = plainText(80, { min: 1 })
export const albumName = plainText(40, { min: 1 })
export const welcomeText = plainText(300, { multiline: true })
export const accentColor = z.string().regex(/^#[0-9a-f]{6}$/i)
export const pin = z.string().regex(/^[0-9]{4}$/)

export const timeZone = z.string().refine((tz) => {
  try {
    new Intl.DateTimeFormat('en', { timeZone: tz })
    return /^[A-Za-z_]+(\/[A-Za-z0-9_+-]+)*$/.test(tz)
  } catch {
    return false
  }
})

export const eventDate = z.iso.date()

export const eventInput = z.object({
  name: eventName,
  eventDate,
  timeZone,
  welcome: welcomeText.default(''),
  accent: accentColor.default('#4a2370'),
  albums: z.array(albumName).max(30).default([]),
  tags: z.array(z.string().max(100)).max(20).default([]),
  pin: pin.nullable().default(null),
})
export type EventInput = z.infer<typeof eventInput>

export const eventPatch = z
  .object({ name: eventName, eventDate, timeZone, welcome: welcomeText, accent: accentColor })
  .partial()
export type EventPatch = z.infer<typeof eventPatch>

export const settingsPatch = z
  .strictObject({
    hearts: z.boolean(),
    comments: z.boolean(),
    guestDownloads: z.boolean(),
    approval: z.boolean(),
    defaultOrder: z.enum(['newest', 'taken', 'featured']),
    // showPin is set through its own route, because it needs the PIN itself.
    tv: z
      .strictObject({
        seconds: z.number().int().min(3).max(60),
        albumId: z.uuid().nullable(),
        showNames: z.boolean(),
        showQr: z.boolean(),
      })
      .partial(),
  })
  .partial()
export type SettingsPatch = z.infer<typeof settingsPatch>
