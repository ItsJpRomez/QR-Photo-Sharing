import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { config } from '@/config'
import { db } from '@/db/client'
import * as authSchema from '@/db/auth-schema'
import { sendMail } from '@/lib/mail'

function create() {
  return betterAuth({
    appName: config.appName,
    baseURL: config.appUrl,
    secret: config.secret,
    trustedOrigins: [config.appUrl],
    database: drizzleAdapter(db, { provider: 'pg', schema: authSchema }),
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 10,
      maxPasswordLength: 128,
      revokeSessionsOnPasswordReset: true,
      sendResetPassword: async ({ user, url }) => {
        await sendMail({
          to: user.email,
          subject: 'Reset your password',
          text: `Choose a new password here:\n\n${url}\n\nIf you didn't ask for this, you can ignore this email.`,
        })
      },
    },
    emailVerification: {
      sendOnSignUp: true,
      autoSignInAfterVerification: true,
      sendVerificationEmail: async ({ user, url }) => {
        await sendMail({
          to: user.email,
          subject: 'Confirm your email address',
          text: `Confirm this address to start creating events:\n\n${url}`,
        })
      },
    },
    socialProviders: config.google ? { google: config.google } : {},
    rateLimit: { enabled: config.env === 'production' && !config.mail.outboxFile },
    advanced: { cookiePrefix: 'host' },
    telemetry: { enabled: false },
  })
}

let instance: ReturnType<typeof create> | undefined

export function getAuth() {
  instance ??= create()
  return instance
}

/** Where to go after signing in. Only paths on this site are allowed. */
export function safeNext(next: string | null | undefined): string {
  if (!next || !/^\/(?![/\\])[\x21-\x5b\x5d-\x7e]*$/.test(next)) return '/host'
  return next
}
