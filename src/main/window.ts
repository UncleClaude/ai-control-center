import { BaseWindow, nativeTheme, type BaseWindowConstructorOptions } from 'electron'
import type { GlassInfo } from './glass'
import { resourcePath } from './paths'

/** Opaque fallback colour, matching the shell's solid gradient. */
export function solidBackground(): string {
  return nativeTheme.shouldUseDarkColors ? '#17181d' : '#eef0f5'
}

/** Neutral page colour shown inside a card before a site paints (avoids a white flash in dark mode). */
export function siteBackground(): string {
  return nativeTheme.shouldUseDarkColors ? '#1e1f23' : '#ffffff'
}

export function createMainWindow(glass: GlassInfo, bounds?: Partial<Electron.Rectangle>): BaseWindow {
  const common: BaseWindowConstructorOptions = {
    width: bounds?.width ?? 1280,
    height: bounds?.height ?? 840,
    x: bounds?.x,
    y: bounds?.y,
    minWidth: 720,
    minHeight: 480,
    title: 'AI Control Center',
    show: false,
  }

  if (process.platform === 'darwin') {
    return new BaseWindow({
      ...common,
      titleBarStyle: 'hiddenInset',
      trafficLightPosition: { x: 20, y: 18 },
      ...(glass.mode === 'vibrancy'
        ? { vibrancy: 'under-window', visualEffectState: 'followWindow', backgroundColor: '#00000000' }
        : { backgroundColor: solidBackground() }),
    })
  }

  // Linux / Windows: native frame, so the title bar and window controls are the OS's own
  // (KWin decoration with the user's theme and button layout, GNOME/Hyprland as configured).
  return new BaseWindow({
    ...common,
    frame: true,
    autoHideMenuBar: true,
    transparent: glass.transparent,
    backgroundColor: glass.transparent ? '#00000000' : solidBackground(),
    icon: resourcePath('icons', 'app.png'),
  })
}
