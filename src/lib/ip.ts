import { config } from '@/config'

/**
 * The visitor's address as reported by our own proxies. Anything further left
 * in the header could have been typed by the visitor, so it is ignored.
 */
export function clientIp(headers: Headers, hops = config.trustedProxyHops): string {
  if (hops < 1) return 'direct'
  const list = (headers.get('x-forwarded-for') ?? '').split(',').map((s) => s.trim())
  return list[list.length - hops] || 'direct'
}
