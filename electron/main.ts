import { app, BrowserWindow, dialog, ipcMain, Menu, session } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { setDataDir, ensureDataLayout, getDataDir } from './database/paths'
import { openDatabase, closeDatabase } from './database/db'
import { seedDefaultsIfNeeded } from './services/settings'
import { initLockOnStartup } from './services/lock'
import { registerAllIpc, missingHandlers } from './ipc'
import { getHandlers } from './ipc/register'
import { installNetworkGuard } from './security/netGuard'
import { createSenderValidator } from './security/ipcGuard'
import { buildMenu } from './menu'
import { log, logException } from './logging/logger'
import { dialogs } from './platform/dialogs'

const DEV_SERVER_URL = app.isPackaged ? undefined : process.env.VITE_DEV_SERVER_URL
const isDev = !!DEV_SERVER_URL

// ---- identity & data location ---------------------------------------------------------------
app.setName('Ledgerly')
const dataDir = process.env.LEDGERLY_DATA_DIR ?? path.join(app.getPath('appData'), 'Ledgerly')
setDataDir(dataDir)
fs.mkdirSync(dataDir, { recursive: true })
// Chromium's own caches live in a sub-folder so the data folder stays tidy and backups stay small.
app.setPath('userData', path.join(dataDir, 'electron'))

// ---- no background networking: Ledgerly is fully offline ------------------------------------
for (const sw of ['disable-background-networking', 'disable-component-update', 'disable-sync', 'no-pings', 'disable-domain-reliability']) {
  app.commandLine.appendSwitch(sw)
}
app.commandLine.appendSwitch('disable-features', 'NetworkTimeServiceQuerying,Translate,OptimizationHints,MediaRouter')

let mainWindow: BrowserWindow | null = null

if (!app.requestSingleInstanceLock()) {
  // Two instances would fight over one SQLite file.
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })
  app.whenReady().then(start).catch((e) => {
    logException('startup', e)
    dialog.showErrorBox('Ledgerly could not start', 'Ledgerly could not start. Your existing files have not been deleted.\n\nPlease restart the application.')
    app.quit()
  })
}

async function start(): Promise<void> {
  ensureDataLayout()

  installNetworkGuard(session.defaultSession, { devServerOrigin: DEV_SERVER_URL })

  try {
    openDatabase()
    seedDefaultsIfNeeded()
    initLockOnStartup()
  } catch (e) {
    logException('database.open', e)
    dialog.showErrorBox(
      'Ledgerly could not open its database',
      'Ledgerly could not open its database.\n\nYour existing files have not been deleted.\n\nPlease restart the application or restore a backup.'
    )
    app.quit()
    return
  }

  registerAllIpc()
  const missing = missingHandlers()
  if (missing.length) log.warn('ipc.missing-handlers', { count: missing.length })

  const isTrusted = createSenderValidator({ devServerUrl: DEV_SERVER_URL, appDir: __dirname })
  for (const [channel, handler] of getHandlers()) {
    ipcMain.handle(channel, (event, arg) => {
      if (!isTrusted(event)) {
        return { ok: false, error: { code: 'LOCKED', message: 'This request was not accepted.' } }
      }
      return handler(arg, { event })
    })
  }

  createWindow()
  Menu.setApplicationMenu(
    buildMenu(() => mainWindow, {
      isDev,
      openDataFolder: () => void dialogs().openFolder(getDataDir())
    })
  )

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
}

function createWindow(): void {
  const iconCandidates = [path.join(__dirname, '..', 'build', 'icon.ico'), path.join(process.resourcesPath ?? '', 'icon.ico')]
  const icon = iconCandidates.find((p) => fs.existsSync(p))

  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 800,
    minHeight: 560,
    show: false,
    title: 'Ledgerly',
    backgroundColor: '#F3F4F7',
    autoHideMenuBar: true,
    icon,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      spellcheck: false,
      devTools: !app.isPackaged
    }
  })
  mainWindow = win

  win.once('ready-to-show', () => win.show())
  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null
  })

  // The window may only ever show the bundled UI.
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  win.webContents.on('will-navigate', (event, url) => {
    const allowed = DEV_SERVER_URL ? url.startsWith(DEV_SERVER_URL) : url.startsWith('file://')
    if (!allowed) event.preventDefault()
  })
  win.webContents.on('will-attach-webview', (event) => event.preventDefault())

  if (DEV_SERVER_URL) void win.loadURL(DEV_SERVER_URL)
  else void win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'))
}

app.on('window-all-closed', () => {
  app.quit()
})

app.on('before-quit', () => {
  closeDatabase()
})
