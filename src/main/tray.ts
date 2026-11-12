import { Menu, nativeImage, Tray, type MenuItemConstructorOptions, type NativeImage } from 'electron'
import type { AiConfig } from './config'
import { resourcePath } from './paths'

export interface TrayHandlers {
  toggleWindow(): void
  openAi(id: string): void
  isCloseToTray(): boolean
  setCloseToTray(value: boolean): void
  quit(): void
}

const isMac = process.platform === 'darwin'

function load(name: string): NativeImage {
  // nativeImage picks up the @2x sibling automatically.
  const image = nativeImage.createFromPath(resourcePath('tray', `${name}.png`))
  if (isMac) image.setTemplateImage(true)
  return image
}

/**
 * System tray / menu bar icon. On Linux Electron speaks StatusNotifierItem over D-Bus, which is
 * what KDE, waybar (Hyprland) and GNOME's AppIndicator extension display under Wayland.
 */
export class AppTray {
  private tray: Tray
  private readonly normal: NativeImage
  private readonly badged: NativeImage
  private badges: Record<string, number> = {}

  constructor(
    private readonly ais: AiConfig[],
    private readonly h: TrayHandlers,
  ) {
    this.normal = load(isMac ? 'trayTemplate' : 'tray')
    this.badged = load(isMac ? 'trayBadgeTemplate' : 'tray-badge')
    this.tray = new Tray(this.normal)
    this.tray.setToolTip('AI Control Center')
    // macOS: a click opens the menu (menu bar convention, right-click too). Linux: click toggles.
    if (!isMac) this.tray.on('click', () => h.toggleWindow())
    this.rebuild()
  }

  setBadges(badges: Record<string, number>): void {
    this.badges = badges
    const total = Object.values(badges).reduce((a, b) => a + b, 0)
    this.tray.setImage(total > 0 ? this.badged : this.normal)
    if (isMac) this.tray.setTitle(total > 0 ? String(total) : '', { fontType: 'monospacedDigit' })
    this.tray.setToolTip(total > 0 ? `AI Control Center — ${total} en attente` : 'AI Control Center')
    this.rebuild()
  }

  private rebuild(): void {
    const items: MenuItemConstructorOptions[] = [
      { label: 'Afficher / masquer', click: () => this.h.toggleWindow() },
      { type: 'separator' },
      ...this.ais.map((ai) => {
        const n = this.badges[ai.id] ?? 0
        return { label: n > 0 ? `${ai.name}  •  ${n}` : ai.name, click: () => this.h.openAi(ai.id) }
      }),
      { type: 'separator' },
      {
        label: 'Garder dans la barre système à la fermeture',
        type: 'checkbox',
        checked: this.h.isCloseToTray(),
        click: (item) => this.h.setCloseToTray(item.checked),
      },
      { type: 'separator' },
      { label: 'Quitter', accelerator: isMac ? 'Cmd+Q' : 'Ctrl+Q', registerAccelerator: false, click: () => this.h.quit() },
    ]
    this.tray.setContextMenu(Menu.buildFromTemplate(items))
  }

  destroy(): void {
    this.tray.destroy()
  }
}
