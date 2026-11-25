import fs from 'node:fs/promises'
import { createTransport } from 'nodemailer'
import { config } from '@/config'

export type Mail = { to: string; subject: string; text: string }

/** Messages "sent" while running tests. */
export const testOutbox: Mail[] = []

export async function sendMail(mail: Mail): Promise<void> {
  if (config.env === 'test') {
    testOutbox.push(mail)
    return
  }
  if (config.mail.outboxFile) {
    await fs.appendFile(config.mail.outboxFile, JSON.stringify(mail) + '\n')
    return
  }
  if (!config.mail.smtpUrl) {
    console.log(`\n--- Email to ${mail.to} ---\n${mail.subject}\n\n${mail.text}\n---\n`)
    return
  }
  await createTransport(config.mail.smtpUrl).sendMail({ from: config.mail.from, ...mail })
}
