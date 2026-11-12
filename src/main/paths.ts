import { join } from 'node:path'
import { app } from 'electron'

/** Bundled resources (icons, tray images): resources/ in dev, Contents/Resources/resources when packaged. */
export function resourcePath(...parts: string[]): string {
  const base = app.isPackaged ? join(process.resourcesPath, 'resources') : join(app.getAppPath(), 'resources')
  return join(base, ...parts)
}

export function preloadPath(name: 'shell' | 'site'): string {
  return join(__dirname, `../preload/${name}.js`)
}
