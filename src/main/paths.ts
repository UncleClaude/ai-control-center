import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { app } from 'electron'

let resourceBase: string | null = null

/**
 * Bundled resources (icons, tray images). Looked up, in order, next to the Electron resources
 * (electron-builder: AppImage, .app), next to app.asar (Arch package running the system electron)
 * and in the project (dev).
 */
export function resourcePath(...parts: string[]): string {
  if (!resourceBase) {
    const appPath = app.getAppPath()
    const candidates = [join(process.resourcesPath, 'resources'), join(dirname(appPath), 'resources'), join(appPath, 'resources')]
    resourceBase = candidates.find((c) => existsSync(join(c, 'tray'))) ?? candidates[candidates.length - 1]
  }
  return join(resourceBase, ...parts)
}

export function preloadPath(name: 'shell' | 'site'): string {
  return join(__dirname, `../preload/${name}.js`)
}
