import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto'
import { config } from '@/config'

const key = (purpose: string) => Buffer.from(hkdfSync('sha256', config.secret, '', purpose, 32))

export function encrypt(text: string, purpose: string): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key(purpose), iv)
  const body = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()])
  return Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64url')
}

/** Null when it was damaged, or made with another secret or for another purpose. */
export function decrypt(data: string, purpose: string): string | null {
  try {
    const raw = Buffer.from(data, 'base64url')
    const decipher = createDecipheriv('aes-256-gcm', key(purpose), raw.subarray(0, 12))
    decipher.setAuthTag(raw.subarray(12, 28))
    return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString('utf8')
  } catch {
    return null
  }
}
