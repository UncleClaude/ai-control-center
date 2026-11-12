import { contextBridge, ipcRenderer } from 'electron'
import { IPC, type ShellApi, type ShellState } from '../shared/protocol'

const api: ShellApi = {
  getState: () => ipcRenderer.invoke(IPC.getState),
  onState: (listener) => {
    const wrapped = (_e: unknown, state: ShellState) => listener(state)
    ipcRenderer.on(IPC.state, wrapped)
    return () => ipcRenderer.off(IPC.state, wrapped)
  },
  select: (id) => ipcRenderer.send(IPC.select, id),
  nav: (action) => ipcRenderer.send(IPC.nav, action),
  setContentRect: (rect) => ipcRenderer.send(IPC.layout, rect),
}

contextBridge.exposeInMainWorld('aicc', api)
