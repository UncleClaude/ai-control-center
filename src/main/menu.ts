import { Menu, type MenuItemConstructorOptions } from 'electron'
import type { AiConfig } from './config'
import type { ShortcutHandlers } from './shortcuts'

/**
 * macOS needs a real menu (Edit roles make Cmd+C/V work inside web pages). Our own shortcuts are
 * handled in before-input-event, so their items only display the accelerator.
 * Linux gets no menu bar: the window is frameless and shortcuts are handled the same way.
 */
export function installMenu(ais: AiConfig[], h: ShortcutHandlers): void {
  if (process.platform !== 'darwin') {
    Menu.setApplicationMenu(null)
    return
  }
  const shown = (accelerator: string) => ({ accelerator, registerAccelerator: false })
  const template: MenuItemConstructorOptions[] = [
    {
      role: 'appMenu',
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { label: 'Réglages…', ...shown('Cmd+,'), click: () => h.openSettings() },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    { role: 'editMenu' },
    {
      label: 'Affichage',
      submenu: [
        ...ais.slice(0, 9).map((ai, i) => ({ label: ai.name, ...shown(`Cmd+${i + 1}`), click: () => h.selectIndex(i) })),
        { type: 'separator' },
        { label: 'Recharger', ...shown('Cmd+R'), click: () => h.nav('reload') },
        { label: 'Précédent', ...shown('Cmd+['), click: () => h.nav('back') },
        { label: 'Suivant', ...shown('Cmd+]'), click: () => h.nav('forward') },
        { type: 'separator' },
        { label: 'Outils de développement', ...shown('Alt+Cmd+I'), click: () => h.toggleDevTools() },
        { role: 'togglefullscreen' },
      ],
    },
    { role: 'windowMenu' },
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}
