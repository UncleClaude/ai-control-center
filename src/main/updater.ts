import { spawn } from 'node:child_process'
import { chmod, copyFile, rename, rm, writeFile } from 'node:fs/promises'
import { createWriteStream } from 'node:fs'
import { once } from 'node:events'
import { join } from 'node:path'
import { app, shell } from 'electron'

/**
 * Self-update from GitHub releases. The app compares its version to the latest release and, on
 * Linux, downloads the new AppImage and swaps it in place (full auto-update). macOS builds are
 * unsigned, so they cannot silently self-install: the dmg is downloaded and opened for the user to
 * drag into Applications. Everything goes through the public releases API; no token is used.
 */

const REPO = 'UncleClaude/ai-control-center'
const RELEASES_URL = `https://github.com/${REPO}/releases/latest`

export interface UpdateAsset {
  name: string
  url: string
  size: number
}
export interface UpdateInfo {
  version: string
  notes: string
  pageUrl: string
  asset?: UpdateAsset
}

export type ApplyResult = 'relaunch' | 'quit' | 'opened' | 'page'

/** Compares dotted versions; >0 when a is newer than b. Pre-release suffixes are ignored. */
function compareVersions(a: string, b: string): number {
  const parse = (v: string) => v.replace(/^v/, '').split(/[.+-]/).map((n) => parseInt(n, 10) || 0)
  const pa = parse(a)
  const pb = parse(b)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (d !== 0) return d
  }
  return 0
}

/** The release asset matching this platform and architecture. */
function assetFor(assets: Array<{ name: string; browser_download_url: string; size: number }>): UpdateAsset | undefined {
  const pick = (match: (name: string) => boolean) => {
    const a = assets.find((x) => match(x.name.toLowerCase()))
    return a ? { name: a.name, url: a.browser_download_url, size: a.size } : undefined
  }
  if (process.platform === 'linux') return pick((n) => n.endsWith('.appimage'))
  if (process.platform === 'darwin') {
    return pick((n) => n.endsWith(`-${process.arch}.dmg`)) ?? pick((n) => n.endsWith('.dmg'))
  }
  return undefined
}

/** Returns the newer release, or null when up to date. Throws on network / API errors. */
export async function checkForUpdate(): Promise<UpdateInfo | null> {
  const res = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
    headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'ai-control-center-updater' },
  })
  if (!res.ok) throw new Error(`GitHub API ${res.status}`)
  const rel = (await res.json()) as {
    tag_name?: string
    body?: string
    html_url?: string
    assets?: Array<{ name: string; browser_download_url: string; size: number }>
  }
  const latest = (rel.tag_name ?? '').replace(/^v/, '')
  if (!latest || compareVersions(latest, app.getVersion()) <= 0) return null
  return {
    version: latest,
    notes: rel.body ?? '',
    pageUrl: rel.html_url ?? RELEASES_URL,
    asset: assetFor(rel.assets ?? []),
  }
}

async function download(url: string, dest: string, onProgress?: (fraction: number) => void, total?: number): Promise<void> {
  const res = await fetch(url, { headers: { 'User-Agent': 'ai-control-center-updater' } })
  if (!res.ok || !res.body) throw new Error(`téléchargement ${res.status}`)
  const size = total ?? (Number(res.headers.get('content-length')) || 0)
  const file = createWriteStream(dest)
  const reader = (res.body as ReadableStream<Uint8Array>).getReader()
  let received = 0
  let lastReport = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      received += value.byteLength
      if (size > 0 && onProgress && received - lastReport > size / 100) {
        lastReport = received
        onProgress(Math.min(1, received / size))
      }
      if (!file.write(value)) await once(file, 'drain')
    }
    onProgress?.(1)
  } finally {
    reader.releaseLock()
    await new Promise<void>((resolve, reject) => file.end((err?: Error | null) => (err ? reject(err) : resolve())))
  }
}

/**
 * Applies an update. Linux: download the AppImage next to the current one and swap it in (atomic
 * rename), returning 'relaunch' so the caller can restart. macOS: download the dmg and open it
 * ('opened'). Anything else, or no matching asset: open the releases page ('page').
 */
export async function applyUpdate(info: UpdateInfo, onProgress?: (fraction: number) => void): Promise<ApplyResult> {
  const appImage = process.env.APPIMAGE
  if (process.platform === 'linux' && appImage && info.asset) {
    const tmp = `${appImage}.new`
    try {
      await download(info.asset.url, tmp, onProgress, info.asset.size)
      await chmod(tmp, 0o755)
      await rename(tmp, appImage)
    } catch (error) {
      await rm(tmp, { force: true }).catch(() => undefined)
      // A cross-device rename (AppImage on another mount) needs a copy instead.
      if ((error as NodeJS.ErrnoException).code === 'EXDEV' && info.asset) {
        await download(info.asset.url, tmp, onProgress, info.asset.size)
        await chmod(tmp, 0o755)
        await copyFile(tmp, appImage)
        await rm(tmp, { force: true }).catch(() => undefined)
      } else {
        throw error
      }
    }
    return 'relaunch'
  }
  if (process.platform === 'darwin' && info.asset) {
    const dest = join(app.getPath('downloads'), info.asset.name)
    await download(info.asset.url, dest, onProgress, info.asset.size)
    // The running .app is three levels up from the executable (…/X.app/Contents/MacOS/exe).
    const bundle = join(process.execPath, '..', '..', '..')
    if (bundle.endsWith('.app')) {
      const script = await writeMacInstaller(dest, bundle)
      // Detached so it outlives this process: it waits for the app to quit, swaps the bundle,
      // clears the quarantine flag, and reopens. The caller quits right after.
      spawn('/bin/bash', [script], { detached: true, stdio: 'ignore' }).unref()
      return 'quit'
    }
    // Not running from /Applications (e.g. straight from the dmg): just open the new dmg.
    await shell.openPath(dest)
    return 'opened'
  }
  await shell.openExternal(info.pageUrl)
  return 'page'
}

/** Writes the macOS install script and returns its path. */
async function writeMacInstaller(dmg: string, bundle: string): Promise<string> {
  const path = join(app.getPath('temp'), 'aicc-update.sh')
  const sh = `#!/bin/bash
# Installs an AI Control Center update: waits for the app to quit, swaps the .app into place,
# removes the Gatekeeper quarantine flag, and reopens. Falls back to opening the dmg on failure.
set -u
DMG=${shq(dmg)}
APP=${shq(bundle)}
PARENT="$(dirname "$APP")"
EXE="$APP/Contents/MacOS"

# Wait (up to ~30s) for the running app to exit.
for _ in $(seq 1 60); do
  pgrep -f "$EXE/" >/dev/null 2>&1 || break
  sleep 0.5
done

MNT="$(mktemp -d /tmp/aicc-mnt.XXXXXX)"
if ! hdiutil attach -nobrowse -noautoopen -mountpoint "$MNT" "$DMG" >/dev/null 2>&1; then
  open "$DMG"; exit 0
fi
SRC="$(/bin/ls -d "$MNT"/*.app 2>/dev/null | head -1)"
if [ -z "$SRC" ]; then hdiutil detach "$MNT" >/dev/null 2>&1; open "$DMG"; exit 0; fi

# Copy beside the old app first (tests write permission), then swap.
STAGE="$PARENT/.aicc-update.app"
rm -rf "$STAGE"
if ! cp -R "$SRC" "$STAGE"; then
  hdiutil detach "$MNT" >/dev/null 2>&1; open "$DMG"; exit 0
fi
hdiutil detach "$MNT" >/dev/null 2>&1 || true
rm -rf "$APP"
if ! mv "$STAGE" "$APP"; then rm -rf "$STAGE"; open "$DMG"; exit 0; fi

xattr -dr com.apple.quarantine "$APP" >/dev/null 2>&1 || true
rm -f "$DMG" >/dev/null 2>&1 || true
open "$APP"
`
  await writeFile(path, sh, { mode: 0o755 })
  return path
}

/** Single-quote a string for bash. */
function shq(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`
}

/** Restarts the app (Linux, after an AppImage swap). */
export function relaunchForUpdate(): void {
  const appImage = process.env.APPIMAGE
  app.relaunch(appImage ? { execPath: appImage } : undefined)
  app.exit(0)
}
