import { execFileSync } from 'node:child_process'
import { createHash, createDecipheriv, pbkdf2Sync } from 'node:crypto'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

/**
 * Reads the user's own browser cookies for a set of domains, so an AI the user signed into in
 * their real browser becomes signed in inside the app too. This avoids embedded sign-in, which
 * Google and others block ("this browser may not be secure"). Everything stays on the machine:
 * nothing is read beyond the requested domains, and nothing is sent anywhere.
 */

export type BrowserKind = 'firefox' | 'chromium' | 'safari'

export interface BrowserProfile {
  /** Stable id used by the UI to pick a source. */
  id: string
  kind: BrowserKind
  /** Human label, e.g. "Firefox" or "Brave — Profile 1". */
  label: string
  /** Cookie store (sqlite file for firefox/chromium, binarycookies for safari). */
  cookiePath: string
  /** Chromium only: the keyring service name used to find the decryption password. */
  service?: string
  lastUsed: number
}

export interface ImportedCookie {
  url: string
  name: string
  value: string
  domain: string
  path: string
  secure: boolean
  httpOnly: boolean
  /** Unix seconds; omitted for session cookies. */
  expirationDate?: number
  sameSite: 'no_restriction' | 'lax' | 'strict'
}

const home = homedir()
const isMac = process.platform === 'darwin'
const isWin = process.platform === 'win32'

function appData(): string {
  if (isWin) return process.env.APPDATA ?? join(home, 'AppData', 'Roaming')
  if (isMac) return join(home, 'Library', 'Application Support')
  return process.env.XDG_CONFIG_HOME ?? join(home, '.config')
}

function safeList(dir: string): string[] {
  try {
    return readdirSync(dir)
  } catch {
    return []
  }
}

function mtime(path: string): number {
  try {
    return statSync(path).mtimeMs
  } catch {
    return 0
  }
}

// ---------- Detection ----------

/**
 * Firefox-family base directories (each holds profiles.ini and the profiles). Covers native,
 * Flatpak, Snap and the XDG ~/.config/mozilla layout. The base differs from the Profiles dir: on
 * macOS/Windows profiles sit under <base>/Profiles, on Linux directly under <base>.
 */
function firefoxBases(): { label: string; base: string }[] {
  const bases: { label: string; base: string }[] = []
  const add = (label: string, base: string) => existsSync(base) && bases.push({ label, base })
  if (isMac) {
    const sup = join(home, 'Library', 'Application Support')
    add('Firefox', join(sup, 'Firefox'))
    add('Firefox', join(sup, 'Firefox Developer Edition'))
    add('Firefox Nightly', join(sup, 'Firefox Nightly'))
    add('LibreWolf', join(sup, 'LibreWolf'))
    add('Waterfox', join(sup, 'Waterfox'))
  } else if (isWin) {
    add('Firefox', join(appData(), 'Mozilla', 'Firefox'))
    add('LibreWolf', join(appData(), 'LibreWolf'))
    add('Waterfox', join(appData(), 'Waterfox'))
  } else {
    add('Firefox', join(home, '.mozilla', 'firefox'))
    // Some builds/configs honour XDG and store the profile under ~/.config/mozilla instead.
    add('Firefox', join(appData(), 'mozilla', 'firefox'))
    add('Firefox', join(home, '.var', 'app', 'org.mozilla.firefox', '.mozilla', 'firefox'))
    add('Firefox', join(home, 'snap', 'firefox', 'common', '.mozilla', 'firefox'))
    add('LibreWolf', join(home, '.librewolf'))
    add('LibreWolf', join(appData(), 'librewolf'))
    add('LibreWolf', join(home, '.var', 'app', 'io.gitlab.librewolf-community', '.librewolf'))
    add('Waterfox', join(home, '.waterfox'))
  }
  return bases
}

/** Profile directories inside a Firefox base: from profiles.ini, plus a scan of likely subdirs. */
function firefoxProfileDirs(base: string): string[] {
  const dirs = new Set<string>()
  // profiles.ini is how Firefox itself locates profiles, wherever they live.
  try {
    const ini = readFileSync(join(base, 'profiles.ini'), 'utf8')
    let relative = true
    for (const raw of ini.split(/\r?\n/)) {
      const line = raw.trim()
      if (line.startsWith('[')) relative = true
      const m = /^(IsRelative|Path)\s*=\s*(.+)$/i.exec(line)
      if (!m) continue
      if (/isrelative/i.test(m[1])) relative = m[2].trim() === '1'
      else dirs.add(relative ? join(base, m[2].trim()) : m[2].trim())
    }
  } catch {
    /* no profiles.ini: fall back to scanning */
  }
  // Fallbacks: profiles directly under the base, and under base/Profiles (macOS/Windows layout).
  for (const name of safeList(base)) dirs.add(join(base, name))
  for (const name of safeList(join(base, 'Profiles'))) dirs.add(join(base, 'Profiles', name))
  return [...dirs]
}

function detectFirefox(): BrowserProfile[] {
  const out: BrowserProfile[] = []
  const seen = new Set<string>()
  for (const { label, base } of firefoxBases()) {
    for (const dir of firefoxProfileDirs(base)) {
      const cookiePath = join(dir, 'cookies.sqlite')
      if (seen.has(cookiePath) || !existsSync(cookiePath)) continue
      seen.add(cookiePath)
      out.push({
        id: `firefox:${cookiePath}`,
        kind: 'firefox',
        label: out.some((p) => p.label === label) ? `${label} — ${dir.split(/[\\/]/).pop()?.replace(/\.default.*/, '') ?? ''}` : label,
        cookiePath,
        lastUsed: mtime(cookiePath),
      })
    }
  }
  return out
}

/** Chromium-family installs, each with its "Safe Storage" keyring service name. */
function chromiumInstalls(): { label: string; root: string; service: string }[] {
  const base = isMac ? join(home, 'Library', 'Application Support') : isWin ? join(process.env.LOCALAPPDATA ?? join(home, 'AppData', 'Local')) : join(home, '.config')
  const defs: { label: string; path: string[]; service: string; flatpak?: string }[] = [
    { label: 'Chrome', path: isWin ? ['Google', 'Chrome', 'User Data'] : isMac ? ['Google', 'Chrome'] : ['google-chrome'], service: 'Chrome' },
    { label: 'Chromium', path: ['chromium'], service: 'Chromium', flatpak: 'org.chromium.Chromium' },
    { label: 'Brave', path: isWin ? ['BraveSoftware', 'Brave-Browser', 'User Data'] : isMac ? ['BraveSoftware', 'Brave-Browser'] : ['BraveSoftware', 'Brave-Browser'], service: 'Brave', flatpak: 'com.brave.Browser' },
    { label: 'Edge', path: isWin ? ['Microsoft', 'Edge', 'User Data'] : isMac ? ['Microsoft Edge'] : ['microsoft-edge'], service: 'Microsoft Edge' },
    { label: 'Vivaldi', path: ['vivaldi'], service: 'Vivaldi', flatpak: 'com.vivaldi.Vivaldi' },
  ]
  const installs: { label: string; root: string; service: string }[] = []
  for (const def of defs) {
    const candidates = [join(base, ...def.path)]
    if (!isMac && !isWin && def.flatpak) candidates.push(join(home, '.var', 'app', def.flatpak, 'config', def.path[0]))
    for (const root of candidates) if (existsSync(root)) installs.push({ label: def.label, root, service: def.service })
  }
  return installs
}

function detectChromium(): BrowserProfile[] {
  const out: BrowserProfile[] = []
  for (const { label, root, service } of chromiumInstalls()) {
    // "Default" plus any "Profile N" directory that has a Cookies DB.
    const profiles = ['Default', ...safeList(root).filter((d) => /^Profile \d+$/.test(d))]
    for (const prof of profiles) {
      // Chromium keeps cookies under Network/Cookies (older builds: directly in the profile).
      const candidates = [join(root, prof, 'Network', 'Cookies'), join(root, prof, 'Cookies')]
      const cookiePath = candidates.find((p) => existsSync(p))
      if (!cookiePath) continue
      out.push({
        id: `chromium:${cookiePath}`,
        kind: 'chromium',
        label: prof === 'Default' ? label : `${label} — ${prof}`,
        cookiePath,
        service,
        lastUsed: mtime(cookiePath),
      })
    }
  }
  return out
}

function detectSafari(): BrowserProfile[] {
  if (!isMac) return []
  const paths = [
    join(home, 'Library', 'Containers', 'com.apple.Safari', 'Data', 'Library', 'Cookies', 'Cookies.binarycookies'),
    join(home, 'Library', 'Cookies', 'Cookies.binarycookies'),
  ]
  const cookiePath = paths.find((p) => existsSync(p))
  return cookiePath ? [{ id: `safari:${cookiePath}`, kind: 'safari', label: 'Safari', cookiePath, lastUsed: mtime(cookiePath) }] : []
}

/** Every browser profile we can read cookies from, most-recently-used first. */
export function detectBrowsers(): BrowserProfile[] {
  const all = [...detectFirefox(), ...detectChromium(), ...detectSafari()]
  return all.sort((a, b) => b.lastUsed - a.lastUsed)
}

/**
 * A verbose report of where the app looked and what it found, for diagnosing failures (especially
 * on macOS, where a path can be blocked rather than simply absent). Distinguishes ENOENT (not
 * there) from EPERM/EACCES (there but access denied — typically needs Full Disk Access).
 */
export function probe(): string {
  const lines: string[] = [`platform=${process.platform} arch=${process.arch} home=${home}`]
  const stat = (path: string): string => {
    try {
      statSync(path)
      return 'ok'
    } catch (error) {
      return (error as NodeJS.ErrnoException).code ?? 'err'
    }
  }
  lines.push('--- Firefox-family bases ---')
  for (const { label, base } of firefoxBases()) {
    const dirs = firefoxProfileDirs(base)
    const withCookies = dirs.filter((d) => existsSync(join(d, 'cookies.sqlite')))
    lines.push(`${label}: ${base} [${stat(base)}] profiles=${dirs.length} withCookies=${withCookies.length}`)
  }
  // Also probe the standard Firefox base even if firefoxBases() skipped it (existsSync=false hides EPERM).
  if (isMac) {
    const ff = join(home, 'Library', 'Application Support', 'Firefox')
    lines.push(`Firefox(std): ${ff} [${stat(ff)}] Profiles=[${stat(join(ff, 'Profiles'))}]`)
  }
  lines.push('--- detected profiles ---')
  for (const p of detectBrowsers()) lines.push(`${p.label} (${p.kind}): ${p.cookiePath}`)
  return lines.join('\n')
}

// ---------- Domain matching ----------

function hostMatches(host: string, domains: readonly string[]): boolean {
  const h = host.replace(/^\./, '').toLowerCase()
  return domains.some((d) => h === d || h.endsWith(`.${d}`))
}

function cookieUrl(host: string, path: string, secure: boolean): string {
  const bare = host.replace(/^\./, '')
  return `${secure ? 'https' : 'http'}://${bare}${path || '/'}`
}

// ---------- Reading a locked SQLite file ----------

/** Browsers keep the DB open with WAL, so we read a copy (with its -wal/-shm) rather than the live file. */
function withCopiedDb<T>(src: string, read: (db: DatabaseSync) => T): T {
  const dir = mkdtempSync(join(tmpdir(), 'aicc-ck-'))
  try {
    const dst = join(dir, 'db.sqlite')
    // read+write rather than copyFileSync: on macOS copyfile() copies ACLs/flags and can fail with
    // EPERM on cookie DBs that are themselves perfectly readable.
    const copy = (from: string, to: string) => writeFileSync(to, readFileSync(from))
    copy(src, dst)
    for (const suffix of ['-wal', '-shm']) if (existsSync(src + suffix)) copy(src + suffix, dst + suffix)
    const db = new DatabaseSync(dst, { readOnly: false }) // read-only can refuse a WAL that needs a checkpoint
    try {
      return read(db)
    } finally {
      db.close()
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

// ---------- Firefox ----------

/** SQLite INTEGER values can exceed JS safe range (Chromium expiry), so statements read BigInt. */
function toNum(v: unknown): number {
  return typeof v === 'bigint' ? Number(v) : Number(v ?? 0)
}

function readFirefox(profile: BrowserProfile, domains: readonly string[]): ImportedCookie[] {
  return withCopiedDb(profile.cookiePath, (db) => {
    const stmt = db.prepare('SELECT host, name, value, path, expiry, isSecure, isHttpOnly, sameSite FROM moz_cookies')
    stmt.setReadBigInts(true)
    const rows = stmt.all() as Array<Record<string, unknown>>
    const out: ImportedCookie[] = []
    for (const r of rows) {
      const host = String(r.host ?? '')
      if (!host || !hostMatches(host, domains)) continue
      const secure = toNum(r.isSecure) === 1
      const path = String(r.path ?? '/')
      const expiry = toNum(r.expiry)
      out.push({
        url: cookieUrl(host, path, secure),
        name: String(r.name ?? ''),
        value: String(r.value ?? ''),
        domain: host,
        path,
        secure,
        httpOnly: toNum(r.isHttpOnly) === 1,
        expirationDate: expiry > 0 ? expiry : undefined,
        sameSite: toNum(r.sameSite) === 2 ? 'strict' : toNum(r.sameSite) === 1 ? 'lax' : 'no_restriction',
      })
    }
    return out
  })
}

// ---------- Chromium ----------

const CHROME_EPOCH_OFFSET = 11_644_473_600 // seconds between 1601-01-01 and 1970-01-01

/** The AES key Chromium derives from its "Safe Storage" password (OS keyring, or a fixed fallback). */
function chromiumKey(service: string): { key: Buffer; iterations: number } | null {
  let password = 'peanuts' // Chromium's fallback when no keyring is available (Linux "basic" store)
  let iterations = 1
  try {
    if (isMac) {
      // Keychain item "<Browser> Safe Storage"; this prompts the user to allow access.
      password = execFileSync('security', ['find-generic-password', '-ga', service, '-w'], { encoding: 'utf8' }).trim()
      iterations = 1003
    } else if (!isWin) {
      // Secret Service (kwallet/gnome-keyring). Try the modern and legacy attribute schemes.
      for (const args of [
        ['lookup', 'application', service.toLowerCase().split(' ')[0]],
        ['lookup', 'xdg:schema', 'chrome_libsecret_os_crypt_password_v2', 'application', service.toLowerCase().split(' ')[0]],
      ]) {
        try {
          const p = execFileSync('secret-tool', args, { encoding: 'utf8' }).trim()
          if (p) {
            password = p
            break
          }
        } catch {
          /* try next */
        }
      }
    } else {
      // Windows uses DPAPI / app-bound encryption, which we do not decrypt here.
      return null
    }
  } catch {
    // Keyring unavailable or access denied: fall back to the fixed password (works for "basic" stores).
  }
  const key = pbkdf2Sync(password, 'saltysalt', iterations, 16, 'sha1')
  return { key, iterations }
}

/** Decrypts one Chromium cookie value (v10/v11 AES-CBC). Returns null if it cannot. */
function decryptChromium(encrypted: Buffer, key: Buffer, hostKey: string): string | null {
  if (encrypted.length === 0) return ''
  const prefix = encrypted.subarray(0, 3).toString('latin1')
  if (prefix !== 'v10' && prefix !== 'v11') {
    // Unencrypted (older) or an unknown scheme (e.g. Windows app-bound): return as-is if it looks plain.
    const text = encrypted.toString('utf8')
    return /[^\x00-\x7f\x80-\xff]/.test(text) ? null : text
  }
  try {
    const iv = Buffer.alloc(16, 0x20)
    const decipher = createDecipheriv('aes-128-cbc', key, iv)
    decipher.setAutoPadding(true)
    let out = Buffer.concat([decipher.update(encrypted.subarray(3)), decipher.final()])
    // Chromium ≥ v130 prepends a 32-byte SHA-256 of the host to the plaintext; strip it when present.
    if (out.length >= 32) {
      const expected = createHash('sha256').update(hostKey).digest()
      if (out.subarray(0, 32).equals(expected)) out = out.subarray(32)
    }
    return out.toString('utf8')
  } catch {
    return null
  }
}

function readChromium(profile: BrowserProfile, domains: readonly string[]): ImportedCookie[] {
  const derived = chromiumKey(profile.service ?? 'Chromium')
  if (!derived) return []
  return withCopiedDb(profile.cookiePath, (db) => {
    const stmt = db.prepare(
      'SELECT host_key, name, value, encrypted_value, path, expires_utc, is_secure, is_httponly, samesite FROM cookies',
    )
    stmt.setReadBigInts(true)
    const rows = stmt.all() as Array<Record<string, unknown>>
    const out: ImportedCookie[] = []
    for (const r of rows) {
      const host = String(r.host_key ?? '')
      if (!host || !hostMatches(host, domains)) continue
      const plain = String(r.value ?? '')
      const enc = r.encrypted_value as Uint8Array | null
      const value = plain || (enc && enc.length ? decryptChromium(Buffer.from(enc), derived.key, host) : '')
      if (value == null) continue
      const secure = toNum(r.is_secure) === 1
      const path = String(r.path ?? '/')
      // expires_utc is microseconds since 1601; it exceeds JS safe range, so divide as BigInt first.
      const rawExpiry = r.expires_utc
      const expiresSec = typeof rawExpiry === 'bigint' ? Number(rawExpiry / 1_000_000n) : Math.floor(toNum(rawExpiry) / 1_000_000)
      out.push({
        url: cookieUrl(host, path, secure),
        name: String(r.name ?? ''),
        value,
        domain: host,
        path,
        secure,
        httpOnly: toNum(r.is_httponly) === 1,
        expirationDate: expiresSec > CHROME_EPOCH_OFFSET ? expiresSec - CHROME_EPOCH_OFFSET : undefined,
        sameSite: toNum(r.samesite) === 2 ? 'strict' : toNum(r.samesite) === 1 ? 'lax' : 'no_restriction',
      })
    }
    return out
  })
}

// ---------- Safari (Cookies.binarycookies) ----------

function readSafari(profile: BrowserProfile, domains: readonly string[]): ImportedCookie[] {
  const buf = readFileSync(profile.cookiePath)
  if (buf.length < 8 || buf.toString('latin1', 0, 4) !== 'cook') return []
  const out: ImportedCookie[] = []
  const pageCount = buf.readUInt32BE(4)
  const pageSizes: number[] = []
  let off = 8
  for (let i = 0; i < pageCount; i++) {
    pageSizes.push(buf.readUInt32BE(off))
    off += 4
  }
  const macEpoch = 978_307_200 // 2001-01-01 in unix seconds
  const cstr = (start: number) => {
    let end = start
    while (end < buf.length && buf[end] !== 0) end++
    return buf.toString('utf8', start, end)
  }
  for (const size of pageSizes) {
    const page = off
    off += size
    if (buf.readUInt32BE(page) !== 0x00000100) continue // page header
    const numCookies = buf.readUInt32LE(page + 4)
    for (let i = 0; i < numCookies; i++) {
      const cookieOff = page + buf.readUInt32LE(page + 8 + i * 4)
      const flags = buf.readUInt32LE(cookieOff + 8)
      const urlOff = cookieOff + buf.readUInt32LE(cookieOff + 16)
      const nameOff = cookieOff + buf.readUInt32LE(cookieOff + 20)
      const pathOff = cookieOff + buf.readUInt32LE(cookieOff + 24)
      const valueOff = cookieOff + buf.readUInt32LE(cookieOff + 28)
      const expiry = buf.readDoubleLE(cookieOff + 40)
      const host = cstr(urlOff)
      if (!host || !hostMatches(host, domains)) continue
      const secure = (flags & 1) !== 0
      const path = cstr(pathOff) || '/'
      out.push({
        url: cookieUrl(host, path, secure),
        name: cstr(nameOff),
        value: cstr(valueOff),
        domain: host,
        path,
        secure,
        httpOnly: (flags & 4) !== 0,
        expirationDate: expiry > 0 ? expiry + macEpoch : undefined,
        sameSite: 'no_restriction',
      })
    }
  }
  return out
}

// ---------- Public read ----------

/** Reads cookies for the given domains from one browser profile. Throws with a clear message on failure. */
export function readCookies(profile: BrowserProfile, domains: readonly string[]): ImportedCookie[] {
  if (!existsSync(profile.cookiePath)) throw new Error('fichier de cookies introuvable (navigateur réinstallé ?)')
  if (profile.kind === 'firefox') return readFirefox(profile, domains)
  if (profile.kind === 'chromium') return readChromium(profile, domains)
  return readSafari(profile, domains)
}

// Anti-bot / CDN / consent cookies are long and http-only but set even when signed out; the
// fallback heuristic must not mistake them for a session.
const NON_SESSION = new Set([
  'cf_clearance',
  '__cf_bm',
  '__cf_waf',
  '_cfuvid',
  'cf_chl_rc_ni',
  'g_state',
  'datadome',
  '_dd_s',
  'OptanonConsent',
  'AWSALB',
  'AWSALBCORS',
])

/**
 * True when the browser holds a logged-in session for `host`. When the AI's session cookie name is
 * known (Claude, ChatGPT), require exactly that — otherwise anti-bot cookies that exist while
 * signed out would trigger a false positive. For unknown sites, fall back to a long http-only
 * cookie that is not a known anti-bot cookie. Reads nothing beyond `host`.
 */
export function hasSession(profile: BrowserProfile, host: string, sessionNames: readonly string[]): boolean {
  try {
    const cookies = readCookies(profile, [host])
    if (sessionNames.length) return cookies.some((c) => sessionNames.includes(c.name) && c.value.length > 0)
    return cookies.some((c) => c.httpOnly && c.value.length >= 20 && !NON_SESSION.has(c.name))
  } catch {
    return false
  }
}
