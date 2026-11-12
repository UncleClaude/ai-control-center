import { session, type Session } from 'electron'
import type { AiConfig } from './config'
import { isInAppUrl } from './navigation'

export const chromeMajor = process.versions.chrome.split('.')[0]

/**
 * A plain desktop Chrome user agent (no "Electron/x" or app token). Google sign-in and some
 * anti-bot checks refuse embedded browsers that advertise themselves.
 */
export function chromeUserAgent(): string {
  const os =
    process.platform === 'darwin'
      ? 'Macintosh; Intel Mac OS X 10_15_7'
      : process.platform === 'win32'
        ? 'Windows NT 10.0; Win64; x64'
        : 'X11; Linux x86_64'
  return `Mozilla/5.0 (${os}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeMajor}.0.0.0 Safari/537.36`
}

const brandsHeader = `"Chromium";v="${chromeMajor}", "Google Chrome";v="${chromeMajor}", "Not?A_Brand";v="99"`

/** Permissions the AI sites need: voice mode, notifications, clipboard, fullscreen video. */
const GRANTED = new Set([
  'notifications',
  'media',
  'clipboard-read',
  'clipboard-sanitized-write',
  'fullscreen',
  'speaker-selection',
])

const prepared = new Set<string>()

export function partitionFor(ai: AiConfig): string {
  return `persist:ai-${ai.id}`
}

/** Persistent, isolated session per AI: cookies and storage survive restarts. */
export function prepareSession(ai: AiConfig): Session {
  const ses = session.fromPartition(partitionFor(ai))
  if (prepared.has(ai.id)) return ses
  prepared.add(ai.id)

  ses.setUserAgent(ai.userAgent ?? chromeUserAgent())

  // Client hints must agree with the user agent.
  ses.webRequest.onBeforeSendHeaders((details, callback) => {
    const headers = details.requestHeaders
    for (const key of Object.keys(headers)) {
      if (key.toLowerCase() === 'sec-ch-ua') headers[key] = brandsHeader
    }
    callback({ requestHeaders: headers })
  })

  const allowed = (permission: string, url: string | undefined) =>
    GRANTED.has(permission) && !!url && isInAppUrl(ai, url)

  ses.setPermissionRequestHandler((_wc, permission, callback, details) => {
    const ok = allowed(permission, details.requestingUrl)
    if (!ok) console.info(`[permissions] ${ai.id} : refus de « ${permission} » pour ${details.requestingUrl}`)
    callback(ok)
  })
  ses.setPermissionCheckHandler((_wc, permission, origin) => allowed(permission, origin))
  return ses
}
