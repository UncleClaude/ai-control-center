import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { app, globalShortcut } from 'electron'

const AUTOSTART_NAME = 'ai-control-center.desktop'
const SYSTEM_LAUNCHER = '/usr/bin/ai-control-center'

function autostartFile(): string {
  const base = process.env.XDG_CONFIG_HOME || join(homedir(), '.config')
  return join(base, 'autostart', AUTOSTART_NAME)
}

/** Command that starts this installation, or null when it cannot be launched at login (sources). */
function launchCommand(): string | null {
  if (process.env.APPIMAGE) return process.env.APPIMAGE
  // Arch package: the app runs from /usr/lib/ai-control-center through the launcher script.
  if (existsSync(SYSTEM_LAUNCHER) && app.getAppPath().startsWith('/usr/lib/ai-control-center')) return SYSTEM_LAUNCHER
  return null
}

/** Null when launch at login works here, otherwise the reason it does not. */
export function launchUnsupported(): string | null {
  if (process.platform === 'darwin') return app.isPackaged ? null : 'disponible uniquement dans l’app installée (.dmg)'
  if (process.platform === 'linux') {
    return launchCommand() ? null : 'disponible avec l’AppImage ou le paquet Arch (pas depuis les sources)'
  }
  return null
}

/** Writes or removes the login item. Linux: an XDG autostart entry (KDE, GNOME, Hyprland with dex/uwsm). */
export function applyLaunchAtLogin(enabled: boolean, hidden: boolean): void {
  if (launchUnsupported()) return
  if (process.platform === 'darwin' || process.platform === 'win32') {
    app.setLoginItemSettings({ openAtLogin: enabled, args: hidden ? ['--hidden'] : [] })
    return
  }
  const file = autostartFile()
  try {
    if (!enabled) {
      rmSync(file, { force: true })
      return
    }
    const cmd = launchCommand()!
    const quoted = /\s/.test(cmd) ? `"${cmd}"` : cmd
    mkdirSync(join(file, '..'), { recursive: true })
    writeFileSync(
      file,
      [
        '[Desktop Entry]',
        'Type=Application',
        'Name=AI Control Center',
        `Exec=${quoted}${hidden ? ' --hidden' : ''}`,
        'Icon=ai-control-center',
        'X-GNOME-Autostart-enabled=true',
        'X-KDE-autostart-after=panel',
        '',
      ].join('\n'),
    )
  } catch (error) {
    console.error('[startup] entrée de démarrage automatique impossible :', error)
  }
}

/** True when this launch should stay in the tray. */
export function startsHidden(startHiddenPref: boolean): boolean {
  if (process.argv.includes('--hidden')) return true
  if (process.platform === 'darwin') return startHiddenPref && app.getLoginItemSettings().wasOpenedAtLogin
  return false
}

let registered: string | null = null

/** (Re)registers the show/hide shortcut. Returns an error message, or null. */
export function applyGlobalShortcut(enabled: boolean, accelerator: string, onPress: () => void): string | null {
  if (registered) globalShortcut.unregister(registered)
  registered = null
  if (!enabled) return null
  try {
    if (!globalShortcut.register(accelerator, onPress)) return 'déjà utilisé par une autre application ou refusé par le système'
    registered = accelerator
    return null
  } catch {
    return 'combinaison invalide (ex. CommandOrControl+Shift+Space)'
  }
}
