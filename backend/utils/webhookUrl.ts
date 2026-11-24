import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'

/**
 * Package 22: SSRF guard for tenant-configured webhook destinations.
 * checkWebhookUrlConfig is intentionally synchronous and side-effect free;
 * validateWebhookUrl adds DNS resolution immediately before a request is sent.
 */

export type WebhookUrlCheck =
  | { ok: true; url: string; hostname: string }
  | { ok: false; reason: string }

const LOCAL_HOST_SUFFIXES = ['.local', '.localhost', '.internal', '.home.arpa']

function ipv4Parts(ip: string): number[] | null {
  if (isIP(ip) !== 4) return null
  const parts = ip.split('.').map((part) => Number(part))
  if (parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return null
  return parts
}

function isBlockedIpv4(ip: string): boolean {
  const parts = ipv4Parts(ip)
  if (!parts) return true
  const [a, b] = parts
  if (a === 0 || a === 10 || a === 127 || a >= 224) return true
  if (a === 169 && b === 254) return true
  if (a === 172 && b >= 16 && b <= 31) return true
  if (a === 192 && (b === 168 || b === 0)) return true
  if (a === 100 && b >= 64 && b <= 127) return true
  if (a === 198 && (b === 18 || b === 19 || b === 51)) return true
  if (a === 203 && b === 0) return true
  if (a === 255) return true
  return false
}

function ipv6Groups(ip: string): number[] | null {
  const lower = ip.toLowerCase().split('%')[0]
  const halves = lower.split('::')
  if (halves.length > 2) return null
  const left = halves[0] ? halves[0].split(':').filter(Boolean) : []
  const right = halves.length === 2 && halves[1] ? halves[1].split(':').filter(Boolean) : []
  const missing = 8 - left.length - right.length
  if (halves.length === 2 ? missing < 1 : missing !== 0) return null
  const groups = [...left, ...Array<string>(missing).fill('0'), ...right].map((group) => Number.parseInt(group, 16))
  if (groups.length !== 8 || groups.some((group) => !Number.isInteger(group) || group < 0 || group > 0xffff)) return null
  return groups
}

function isBlockedIpv6(ip: string): boolean {
  const groups = ipv6Groups(ip)
  if (!groups) return true
  const [a, b, c, d, e, f] = groups
  if (groups.every((group) => group === 0)) return true
  if (groups.slice(0, 7).every((group) => group === 0) && groups[7] === 1) return true
  if ((a & 0xfe00) === 0xfc00) return true // unique local (fc00::/7)
  if ((a & 0xffc0) === 0xfe80) return true // link local (fe80::/10)
  if (a === 0xfec0 || a === 0xfed0 || a === 0xfee0 || a === 0xfef0) return true // deprecated site local
  if ((a & 0xff00) === 0xff00) return true // multicast
  if (a === 0x2001 && b === 0x0db8) return true // documentation range
  if (a === 0 && b === 0 && c === 0 && d === 0 && e === 0 && f === 0xffff) {
    // IPv4-mapped IPv6: validate the embedded address instead of the wrapper.
    return isBlockedIpv4(`${groups[6] >> 8}.${groups[6] & 0xff}.${groups[7] >> 8}.${groups[7] & 0xff}`)
  }
  return false
}

/** True for loopback/private/link-local/mapped addresses and invalid IPs. */
export function isBlockedIpAddress(ip: string): boolean {
  const version = isIP(ip)
  if (version === 4) return isBlockedIpv4(ip)
  if (version === 6) return isBlockedIpv6(ip)
  return true
}

export function privateWebhookUrlsAllowed(): boolean {
  return process.env.WEBHOOK_ALLOW_PRIVATE_URLS === 'true' && process.env.NODE_ENV !== 'production'
}

/** Synchronous structural check. DNS is checked separately before delivery. */
export function checkWebhookUrlConfig(raw: unknown): WebhookUrlCheck {
  if (typeof raw !== 'string' || raw.trim().length === 0) {
    return { ok: false, reason: 'url is required' }
  }
  if (raw.length > 2048) return { ok: false, reason: 'url is too long' }

  let parsed: URL
  try {
    parsed = new URL(raw.trim())
  } catch {
    return { ok: false, reason: 'url must be an absolute http(s) URL' }
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { ok: false, reason: 'only http and https URLs are allowed' }
  }
  if (parsed.username || parsed.password) {
    return { ok: false, reason: 'credentials in webhook URLs are not allowed' }
  }
  if (!parsed.hostname) return { ok: false, reason: 'url hostname is required' }

  const hostname = parsed.hostname.replace(/^\[|\]$/g, '').replace(/\.$/, '').toLowerCase()
  if (!hostname) return { ok: false, reason: 'url hostname is required' }
  if (hostname === 'localhost' || LOCAL_HOST_SUFFIXES.some((suffix) => hostname.endsWith(suffix))) {
    if (!privateWebhookUrlsAllowed()) return { ok: false, reason: 'private webhook URLs are not allowed' }
  }
  if (isIP(hostname)) {
    if (isBlockedIpAddress(hostname) && !privateWebhookUrlsAllowed()) {
      return { ok: false, reason: 'private or loopback webhook IPs are not allowed' }
    }
  }

  return { ok: true, url: parsed.toString(), hostname }
}

/** Full pre-delivery validation, including DNS resolution of every address. */
export async function validateWebhookUrl(raw: unknown): Promise<string> {
  const checked = checkWebhookUrlConfig(raw)
  if (!checked.ok) throw new Error(checked.reason)
  if (privateWebhookUrlsAllowed()) return checked.url

  let addresses: Array<{ address: string }>
  try {
    addresses = await lookup(checked.hostname, { all: true, verbatim: true })
  } catch {
    throw new Error('webhook hostname could not be resolved')
  }
  if (!addresses.length) throw new Error('webhook hostname could not be resolved')
  for (const { address } of addresses) {
    if (isBlockedIpAddress(address)) {
      throw new Error('webhook hostname resolves to a blocked address')
    }
  }
  return checked.url
}
