import { z } from 'zod'

const GB = 1024 ** 3
const MB = 1024 ** 2

const optional = z.string().optional().transform((v) => v?.trim() || undefined)

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  APP_NAME: optional,
  APP_URL: z.url(),
  APP_SECRET: z.string().min(32),
  DATABASE_URL: z.string().min(1),
  STORAGE_DRIVER: z.enum(['disk', 's3']).default('disk'),
  STORAGE_DIR: optional,
  S3_ENDPOINT: optional,
  S3_REGION: optional,
  S3_BUCKET: optional,
  S3_ACCESS_KEY_ID: optional,
  S3_SECRET_ACCESS_KEY: optional,
  SMTP_URL: optional,
  MAIL_FROM: optional,
  /** Browser tests read emails from this file. Local only. */
  MAIL_OUTBOX_FILE: optional,
  GOOGLE_CLIENT_ID: optional,
  GOOGLE_CLIENT_SECRET: optional,
  TRUSTED_PROXY_HOPS: z.coerce.number().int().min(0).default(0),
  REPORT_EMAIL: optional,
  /** Lets the production build run locally against disk storage for browser tests. */
  ALLOW_LOCAL_DRIVERS: optional,
})

export type S3Config = { endpoint: string; region: string; bucket: string; accessKeyId: string; secretAccessKey: string }

export type Config = {
  env: 'development' | 'test' | 'production'
  appName: string
  appUrl: string
  secret: string
  databaseUrl: string
  storage: { driver: 'disk'; dir: string } | ({ driver: 's3' } & S3Config)
  mail: { smtpUrl?: string; from: string; outboxFile?: string }
  google?: { clientId: string; clientSecret: string }
  trustedProxyHops: number
  reportEmail: string
  limits: {
    photosPerEvent: number
    bytesPerEvent: number
    eventsPerHost: number
    photosPerGuest: number
    reservationsPerMinute: number
    commentsPerMinute: number
    maxPhotoBytes: number
    maxPixels: number
  }
}

function isLoopback(url: string): boolean {
  const host = new URL(url).hostname
  return host === 'localhost' || host === '127.0.0.1' || host === '[::1]'
}

export function parseConfig(env: Record<string, string | undefined>): Config {
  const parsed = schema.safeParse(env)
  if (!parsed.success) {
    const names = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')
    throw new Error(`Invalid configuration. ${names}`)
  }
  const e = parsed.data
  // Local drivers are for this machine only, so the escape hatch works only on a loopback address.
  const local = e.NODE_ENV !== 'production' || (e.ALLOW_LOCAL_DRIVERS === '1' && isLoopback(e.APP_URL))

  let storage: Config['storage']
  if (e.STORAGE_DRIVER === 'disk') {
    if (!local) throw new Error('The disk storage driver is for development only. Set STORAGE_DRIVER=s3.')
    storage = { driver: 'disk', dir: e.STORAGE_DIR ?? '.data/storage' }
  } else {
    const need = (name: 'S3_ENDPOINT' | 'S3_BUCKET' | 'S3_ACCESS_KEY_ID' | 'S3_SECRET_ACCESS_KEY') => {
      const v = e[name]
      if (!v) throw new Error(`Invalid configuration. ${name} is required when STORAGE_DRIVER=s3.`)
      return v
    }
    storage = {
      driver: 's3',
      bucket: need('S3_BUCKET'),
      endpoint: need('S3_ENDPOINT'),
      region: e.S3_REGION ?? 'auto',
      accessKeyId: need('S3_ACCESS_KEY_ID'),
      secretAccessKey: need('S3_SECRET_ACCESS_KEY'),
    }
  }

  if (!local && !e.SMTP_URL) throw new Error('Invalid configuration. SMTP_URL is required in production.')

  const appName = e.APP_NAME ?? 'Event Photos'
  return {
    env: e.NODE_ENV,
    appName,
    appUrl: e.APP_URL.replace(/\/+$/, ''),
    secret: e.APP_SECRET,
    databaseUrl: e.DATABASE_URL,
    storage,
    mail: {
      smtpUrl: e.SMTP_URL,
      from: e.MAIL_FROM ?? `${appName} <noreply@localhost>`,
      outboxFile: local ? e.MAIL_OUTBOX_FILE : undefined,
    },
    google:
      e.GOOGLE_CLIENT_ID && e.GOOGLE_CLIENT_SECRET
        ? { clientId: e.GOOGLE_CLIENT_ID, clientSecret: e.GOOGLE_CLIENT_SECRET }
        : undefined,
    trustedProxyHops: e.TRUSTED_PROXY_HOPS,
    reportEmail: e.REPORT_EMAIL ?? 'report@localhost',
    limits: {
      photosPerEvent: 5000,
      bytesPerEvent: 25 * GB,
      eventsPerHost: 10,
      photosPerGuest: 500,
      reservationsPerMinute: 60,
      commentsPerMinute: 10,
      maxPhotoBytes: 40 * MB,
      maxPixels: 100_000_000,
    },
  }
}

let cached: Config | undefined

/** Parsed on first use, so `next build` does not need runtime settings. */
export const config: Config = new Proxy({} as Config, {
  get(_target, key) {
    cached ??= parseConfig(process.env)
    return cached[key as keyof Config]
  },
})
