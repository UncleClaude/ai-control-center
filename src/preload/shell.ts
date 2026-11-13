import { contextBridge, ipcRenderer } from 'electron'
import { IPC, type ShellApi, type ShellState } from '../shared/protocol'

const api: ShellApi = {
  getState: () => ipcRenderer.invoke(IPC.getState),
  onState: (listener) => {
    const wrapped = (_e: unknown, state: ShellState) => listener(state)
    ipcRenderer.on(IPC.state, wrapped)
    return () => ipcRenderer.off(IPC.state, wrapped)
  },
  onPlaySound: (listener) => {
    const wrapped = () => listener()
    ipcRenderer.on(IPC.playSound, wrapped)
    return () => ipcRenderer.off(IPC.playSound, wrapped)
  },
  onOpenSettings: (listener) => {
    const wrapped = () => listener()
    ipcRenderer.on(IPC.openSettings, wrapped)
    return () => ipcRenderer.off(IPC.openSettings, wrapped)
  },
  setSettingsVisible: (visible) => ipcRenderer.send(IPC.settingsVisible, visible),
  getSettings: () => ipcRenderer.invoke(IPC.getSettings),
  setSettings: (patch) => ipcRenderer.invoke(IPC.setSettings, patch),
  openPath: (which) => ipcRenderer.send(IPC.openPath, which),
  testNotification: (aiId) => ipcRenderer.send(IPC.testNotification, aiId),
  aiAction: (aiId, action) => ipcRenderer.invoke(IPC.aiAction, aiId, action),
  addAi: (spec) => ipcRenderer.invoke(IPC.addAi, spec),
  removeAi: (id) => ipcRenderer.invoke(IPC.removeAi, id),
  renameAi: (id, name) => ipcRenderer.invoke(IPC.renameAi, id, name),
  onLoginStatus: (listener) => {
    const wrapped = (_e: unknown, status: Parameters<typeof listener>[0]) => listener(status)
    ipcRenderer.on(IPC.loginStatus, wrapped)
    return () => ipcRenderer.off(IPC.loginStatus, wrapped)
  },
  loginAction: (aiId, action) => ipcRenderer.send(IPC.loginAction, aiId, action),
  checkUpdate: () => ipcRenderer.invoke(IPC.checkUpdate),
  applyUpdate: () => ipcRenderer.invoke(IPC.applyUpdate),
  onUpdateProgress: (listener) => {
    const wrapped = (_e: unknown, fraction: number) => listener(fraction)
    ipcRenderer.on(IPC.updateProgress, wrapped)
    return () => ipcRenderer.off(IPC.updateProgress, wrapped)
  },
  onUpdateAvailable: (listener) => {
    const wrapped = (_e: unknown, update: Parameters<typeof listener>[0]) => listener(update)
    ipcRenderer.on(IPC.updateAvailable, wrapped)
    return () => ipcRenderer.off(IPC.updateAvailable, wrapped)
  },
  select: (id) => ipcRenderer.send(IPC.select, id),
  nav: (action) => ipcRenderer.send(IPC.nav, action),
  setContentRect: (rect) => ipcRenderer.send(IPC.layout, rect),
  windowControl: (action) => ipcRenderer.send(IPC.windowControl, action),
}

contextBridge.exposeInMainWorld('aicc', api)
