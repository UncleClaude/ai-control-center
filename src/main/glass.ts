import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { GlassMode, GlassPreference } from '../shared/protocol'

export interface GlassInfo {
  mode: GlassMode
  /** Whether the native window must be created transparent. */
  transparent: boolean
  reason: string
}

/**
 * Picks how the app chrome is rendered:
 * - vibrancy: macOS NSVisualEffectView behind the whole window (real desktop blur)
 * - blur: transparent window, the compositor blurs what is behind (Hyprland, KWin + force-blur plugin)
 * - tint: transparent window but nothing blurs it: semi-opaque gradient so it still looks right
 * - solid: opaque window with the same gradient (no compositor transparency at all)
 */
export function detectGlass(preference: GlassPreference): GlassInfo {
  if (process.platform === 'darwin') {
    if (preference === 'solid') return { mode: 'solid', transparent: false, reason: 'préférence' }
    return { mode: 'vibrancy', transparent: false, reason: 'macOS' }
  }
  if (process.platform !== 'linux') return { mode: 'solid', transparent: false, reason: process.platform }

  if (preference === 'solid') return { mode: 'solid', transparent: false, reason: 'préférence' }
  if (preference === 'glass') return { mode: 'blur', transparent: true, reason: 'préférence' }

  const env = process.env
  if (env.HYPRLAND_INSTANCE_SIGNATURE) return { mode: 'blur', transparent: true, reason: 'Hyprland' }

  const desktop = `${env.XDG_CURRENT_DESKTOP ?? ''}:${env.DESKTOP_SESSION ?? ''}`.toLowerCase()
  if (desktop.includes('kde') || desktop.includes('plasma')) {
    return kwinForceBlur()
      ? { mode: 'blur', transparent: true, reason: 'KWin + plugin de flou forcé' }
      : { mode: 'tint', transparent: true, reason: 'KWin sans plugin de flou forcé' }
  }
  if (env.WAYLAND_DISPLAY || desktop) return { mode: 'tint', transparent: true, reason: desktop || 'Wayland' }
  return { mode: 'solid', transparent: false, reason: 'pas de compositeur détecté' }
}

/**
 * KWin only blurs windows that ask for it (Electron cannot). A force-blur effect such as
 * Better Blur DX does it by window class; we treat "such a plugin is enabled" as glass-capable.
 */
function kwinForceBlur(): boolean {
  const configHome = process.env.XDG_CONFIG_HOME || join(homedir(), '.config')
  const file = join(configHome, 'kwinrc')
  if (!existsSync(file)) return false
  let inPlugins = false
  for (const raw of readFileSync(file, 'utf8').split('\n')) {
    const line = raw.trim()
    if (line.startsWith('[')) inPlugins = line === '[Plugins]'
    else if (inPlugins && /^(?!blurEnabled=)[\w-]*blur[\w-]*Enabled=true$/i.test(line)) return true
  }
  return false
}
