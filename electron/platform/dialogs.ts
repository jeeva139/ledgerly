// Native Windows dialogs and shell helpers behind an interface, so that handlers stay testable
// without Electron (tests install a fake provider with setDialogProvider()).
import { AppError } from '../../shared/errors'

export interface FileFilter {
  name: string
  extensions: string[]
}

export interface DialogProvider {
  /** Resolves with the chosen paths, or null when the user cancels. */
  openFile(opts: { title: string; filters?: FileFilter[]; multiple?: boolean }): Promise<string[] | null>
  /** Resolves with the chosen path, or null when the user cancels. */
  saveFile(opts: { title: string; defaultPath: string; filters?: FileFilter[] }): Promise<string | null>
  /** Open a file with the default Windows application. Resolves with an error string or ''. */
  openPath(filePath: string): Promise<string>
  /** Open a folder in Explorer. */
  openFolder(dir: string): Promise<string>
}

function electron(): typeof import('electron') {
  // Loaded lazily so the module can be imported in plain Node (tests).
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('electron') as typeof import('electron')
}

const electronProvider: DialogProvider = {
  async openFile({ title, filters, multiple }) {
    const { dialog, BrowserWindow } = electron()
    const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
    const opts: Electron.OpenDialogOptions = {
      title,
      filters,
      properties: ['openFile', ...(multiple ? (['multiSelections'] as const) : [])]
    }
    const res = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
    return res.canceled || res.filePaths.length === 0 ? null : res.filePaths
  },
  async saveFile({ title, defaultPath, filters }) {
    const { dialog, BrowserWindow } = electron()
    const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
    const opts: Electron.SaveDialogOptions = { title, defaultPath, filters }
    const res = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts)
    return res.canceled || !res.filePath ? null : res.filePath
  },
  async openPath(filePath) {
    return electron().shell.openPath(filePath)
  },
  async openFolder(dir) {
    return electron().shell.openPath(dir)
  }
}

const unavailable: DialogProvider = {
  async openFile() {
    throw new AppError('UNSUPPORTED', 'File dialogs are not available in this environment.')
  },
  async saveFile() {
    throw new AppError('UNSUPPORTED', 'File dialogs are not available in this environment.')
  },
  async openPath() {
    return 'unavailable'
  },
  async openFolder() {
    return 'unavailable'
  }
}

let provider: DialogProvider | null = null

export function setDialogProvider(p: DialogProvider | null): void {
  provider = p
}

export function dialogs(): DialogProvider {
  if (provider) return provider
  return process.versions.electron && !process.env.ELECTRON_RUN_AS_NODE ? electronProvider : unavailable
}
