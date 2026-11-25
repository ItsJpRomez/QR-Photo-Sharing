import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { config } from '@/config'

const BASE58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'
const CEILING = 256 - (256 % BASE58.length)

export function newEventCode(): string {
  let code = ''
  while (code.length < 12) {
    for (const byte of randomBytes(16)) {
      if (byte >= CEILING) continue // skipped so every character is equally likely
      code += BASE58[byte % BASE58.length]
      if (code.length === 12) break
    }
  }
  return code
}

export function newToken(): string {
  return randomBytes(32).toString('base64url')
}

export function sha256Hex(data: string | Buffer): string {
  return createHash('sha256').update(data).digest('hex')
}

export function hmacHex(data: string): string {
  return createHmac('sha256', config.secret).update(data).digest('hex')
}

export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a)
  const y = Buffer.from(b)
  return x.length === y.length && timingSafeEqual(x, y)
}
