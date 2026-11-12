import { join } from 'node:path'
import { app, BaseWindow, WebContentsView } from 'electron'

function createWindow(): void {
  const win = new BaseWindow({ width: 1280, height: 840, title: 'AI Control Center' })
  const shell = new WebContentsView({
    webPreferences: {
      preload: join(__dirname, '../preload/shell.js'),
      contextIsolation: true,
      sandbox: true,
    },
  })
  win.contentView.addChildView(shell)
  const layout = () => {
    const { width, height } = win.getContentBounds()
    shell.setBounds({ x: 0, y: 0, width, height })
  }
  win.on('resize', layout)
  layout()
  if (process.env.ELECTRON_RENDERER_URL) shell.webContents.loadURL(process.env.ELECTRON_RENDERER_URL)
  else shell.webContents.loadFile(join(__dirname, '../renderer/index.html'))
}

app.whenReady().then(createWindow)
app.on('window-all-closed', () => app.quit())
